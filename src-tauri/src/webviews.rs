use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{self, Write},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    utils::config::BackgroundThrottlingPolicy,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    window::WindowBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

use crate::{adapters, bridge::BridgeMessage, settings};

#[path = "webviews/provider_ipc.rs"]
mod provider_ipc;
use provider_ipc::{
    build_provider_control_script, provider_bridge_read_script, CHATGPT_BRIDGE_ACK_PREFIX,
    CHATGPT_BRIDGE_HEALTH_JS, CHATGPT_BRIDGE_PEEK_JS,
};
#[cfg(target_os = "macos")]
use crate::claude_login_tabs;

const BOOTSTRAP_JS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/gen/injected/bootstrap.js"
));
const ENGINE_JS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/gen/injected/engine.js"
));
const CHALLENGE_SIGNALS_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/challenge-signals.json"
));
const PROVIDER_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";
const NEW_SESSION_READY_TIMEOUT_SECS: u64 = 30;
const NEW_SESSION_READY_POLL_MS: u64 = 150;
const GROK_POPUP_RECOVERY_DELAY_MS: u64 = 500;
const GROK_EXTERNAL_AUTH_RETURN_DELAY_MS: u64 = 1_000;
const GROK_NAVIGATION_START_LEASE_MS: u64 = 15_000;
const STATUS_STALE_CHECK_MS: u64 = 30_000;
const STATUS_EXPIRED_MS: u64 = 40_000;
const GROK_APP_TITLE_UNCONFIRMED_REASON: &str = "grok_app_title_unconfirmed";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeSignals {
    title_signals: Vec<String>,
}

fn challenge_signals() -> &'static ChallengeSignals {
    static SIGNALS: OnceLock<ChallengeSignals> = OnceLock::new();
    SIGNALS.get_or_init(|| {
        serde_json::from_str(CHALLENGE_SIGNALS_JSON)
            .expect("shared/challenge-signals.json must be valid")
    })
}
/// Auto-deny site permission prompts that otherwise pop a blocking native dialog.
/// SCOPE: Notifications + Geolocation ONLY. We intentionally leave microphone/camera alone so the
/// providers' voice-input buttons keep working. Runs at document-start, before site scripts.
const PERMISSION_SHIM_JS: &str = r#"(function () {
  try {
    if (location.hostname === 'www.google.com' && (location.pathname === '/sorry' || location.pathname.indexOf('/sorry/') === 0)) return;
    // Cloudflare Turnstile frames must see stock browser APIs (same rationale as the Grok
    // top-page exemption): ChatGPT's auth flow serves Turnstile in iframes, and a patched
    // navigator.permissions inside the challenge frame reads as tampering.
    if (/(^|\.)challenges\.cloudflare\.com$/.test(location.hostname)) return;
    if (typeof Notification !== 'undefined') {
      try { Object.defineProperty(Notification, 'permission', { get: function () { return 'denied'; }, configurable: true }); } catch (e) {}
      try { Notification.requestPermission = function (cb) { if (typeof cb === 'function') { try { cb('denied'); } catch (e) {} } return Promise.resolve('denied'); }; } catch (e) {}
    }
    if (navigator.geolocation) {
      var denyGeo = function (_s, err) { if (typeof err === 'function') { try { err({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); } catch (e) {} } };
      try { navigator.geolocation.getCurrentPosition = function (s, err) { denyGeo(s, err); }; } catch (e) {}
      try { navigator.geolocation.watchPosition = function (s, err) { denyGeo(s, err); return 0; }; } catch (e) {}
    }
    if (navigator.permissions && navigator.permissions.query) {
      var origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (desc) {
        try {
          if (desc && (desc.name === 'notifications' || desc.name === 'geolocation')) {
            return Promise.resolve({ state: 'denied', status: 'denied', onchange: null, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } });
          }
        } catch (e) {}
        return origQuery(desc);
      };
    }
  } catch (e) {}
})();"#;

fn provider_uses_permission_shim(provider: &str) -> bool {
    // The clean WKWebView probe successfully authenticated Claude with unmodified WebKit APIs.
    // Do not run a permission shim in Claude's login, SSO, or app documents.
    provider != "grok" && provider != "claude"
}

fn provider_uses_document_start_bridge(provider: &str) -> bool {
    // Never install a document-start script in a Claude authentication document.
    // Claude's bridge is installed only after the authenticated composer appears.
    provider != "grok" && provider != "claude"
}

/// Positive, exact-match allowlist for injecting automation into an authenticated Claude tab.
/// A provider host match by itself is insufficient: /login and authentication callbacks are
/// hosted on claude.ai too. Keep this separate from navigation/SSO URL allowlisting.
fn claude_conversation_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("claude.ai")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && (url.path() == "/new"
            || url.path().strip_prefix("/chat/").is_some_and(|id| !id.is_empty() && !id.contains('/')))
}

// Read-only. Never inspect an authentication field's contents or any session storage.
// Confirm a real Claude composer exists before installing *any* automation script.
// Repeat this guard inside the installation JS to close the navigation race between
// the native URL check and WebKit's script execution.
const CLAUDE_COMPOSER_READY_JS: &str = r#"(function () {
  if (location.origin !== 'https://claude.ai') return false;
  if (!(location.pathname === '/new' || /^\/chat\/[^/]+$/.test(location.pathname))) return false;
  if (document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[type="email"]')) return false;
  return !!document.querySelector('.ProseMirror[contenteditable="true"]');
})()"#;

fn guard_claude_automation(js: &str) -> String {
    format!("(function () {{ if (!({CLAUDE_COMPOSER_READY_JS})) return;\n{js}\n}})();")
}

/// Unlike the document-start bridge, this probe never executes on login or SSO.
/// A successful clean WKWebView test showed that user authentication is possible without
/// scripts. Wait for the logged-in composer rather than guessing from the URL alone.
/// A hidden signed-in Claude tab can finish loading without another document-title
/// or page-load event. Recover that missing bridge without assuming authentication
/// from the URL or evaluating JavaScript into login / CAPTCHA documents.
fn claude_background_recovery_needed(state: &ProviderState, now: u64) -> bool {
    state.provider == "claude"
        && state.webview == "loaded"
        && state.dom != "ready"
        && !state.thinking
        && matches!(state.login.as_str(), "unknown" | "logged_in")
        && state.bridge == "ok"
        && state.adapter == "ok"
        && now.saturating_sub(state.last_status_at) >= 5_000
}

fn schedule_claude_bridge_install(app: &AppHandle, webview: &tauri::Webview) {
    // Both title and load events can fire during SPA navigation. Never launch
    // simultaneous installers or install the engine twice in the same document.
    static CLAUDE_INSTALL_INFLIGHT: OnceLock<Mutex<bool>> = OnceLock::new();
    let lock = CLAUDE_INSTALL_INFLIGHT.get_or_init(|| Mutex::new(false));
    if let Ok(mut running) = lock.lock() {
        if *running { return; }
        *running = true;
    } else {
        return;
    }
    let app = app.clone();
    let webview = webview.clone();
    tauri::async_runtime::spawn(async move {
        let _ = async {
        for _ in 0..60 {
            if !webview.url().ok().is_some_and(|url| claude_conversation_url(&url)) {
                // Navigation can be in progress: do not run scripts, but allow
                // a successful authentication redirect to finish in this window.
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            let (sender, receiver) = tokio::sync::oneshot::channel();
            let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
            let callback_sender = sender.clone();
            if webview.eval_with_callback(CLAUDE_COMPOSER_READY_JS, move |result| {
                if let Ok(mut guard) = callback_sender.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(result);
                    }
                }
            }).is_ok() {
                if let Ok(Ok(result)) = tokio::time::timeout(Duration::from_secs(2), receiver).await {
                    if result.trim() == "true" {
                        // The bootstrap is also guarded inside WebKit. It does not run on login.
                        if install_claude_bridge(&app).is_ok() { return; }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        }.await;
        if let Some(lock) = CLAUDE_INSTALL_INFLIGHT.get() {
            if let Ok(mut running) = lock.lock() { *running = false; }
        }
    });
}

fn install_claude_bridge(app: &AppHandle) -> Result<(), String> {
    let provider = "claude";
    let webview = get_provider_webview(app, provider)?;
    let url = webview.url().map_err(|error| error.to_string())?;
    if !claude_conversation_url(&url) {
        return Err("Claude bridge is disabled on non-conversation pages".into());
    }
    let app_hosts = serde_json::to_string(&adapters::app_hosts_for_provider(provider)?)
        .map_err(|error| error.to_string())?;
    let js = format!(
        "if (!window.__MAC_BRIDGE__) {{ window.__MAC_PROVIDER__='claude';\nwindow.__MAC_APP_HOSTS__={app_hosts};\n{BOOTSTRAP_JS} }}"
    );
    eval_provider(app, provider, &guard_claude_automation(&js))?;
    push_engine_and_adapter(app, provider)
}

fn grok_app_title_ready(provider: &str, title: &str) -> bool {
    if provider != "grok" {
        return false;
    }
    let normalized = title.trim().to_lowercase();
    normalized == "grok" || normalized.starts_with("grok - ") || normalized.starts_with("grok — ")
}

fn grok_bridge_install_ready(provider: &str, title: &str, url: &tauri::Url) -> bool {
    grok_app_title_ready(provider, title)
        && adapters::url_matches_provider_app(provider, url).unwrap_or(false)
}

fn grok_challenge_title_active(provider: &str, title: &str) -> bool {
    if provider != "grok" {
        return false;
    }
    let normalized = title.trim().to_lowercase();
    challenge_signals()
        .title_signals
        .iter()
        .any(|signal| normalized.contains(signal))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrokDocumentTitleSignal {
    Ignore,
    Challenge,
    App,
}

fn grok_document_title_signal(
    provider: &str,
    title: &str,
    url: &tauri::Url,
) -> GrokDocumentTitleSignal {
    if !adapters::url_matches_provider_app(provider, url).unwrap_or(false) {
        return GrokDocumentTitleSignal::Ignore;
    }
    // A challenge title can also begin with the provider name (for example,
    // "Grok — Performing security verification"). Never let that overlap authorize injection.
    if grok_challenge_title_active(provider, title) {
        return GrokDocumentTitleSignal::Challenge;
    }
    if grok_bridge_install_ready(provider, title, url) {
        return GrokDocumentTitleSignal::App;
    }
    GrokDocumentTitleSignal::Ignore
}

fn handle_provider_document_title(app: &AppHandle, provider: &str, title: &str) {
    let _ = crate::bridge::ingest_title(app, provider, title);
}

fn set_provider_challenge_blocked(app: &AppHandle, provider: &str) {
    let mut state = current_state(provider);
    if state.webview == "loaded"
        && state.dom == "unknown"
        && state.login == "blocked"
        && !state.thinking
        && state.bridge_reason.is_none()
    {
        return;
    }
    state.webview = "loaded".into();
    state.dom = "unknown".into();
    state.login = "blocked".into();
    state.thinking = false;
    state.last_status_at = now_ms();
    state.bridge_reason = None;
    set_state(app, state);
}

fn clear_provider_challenge_blocked(app: &AppHandle, provider: &str) {
    let mut state = current_state(provider);
    if provider != "grok" || state.login != "blocked" {
        return;
    }
    state.dom = "unknown".into();
    state.login = "unknown".into();
    state.thinking = false;
    state.last_status_at = now_ms();
    state.bridge_reason = None;
    set_state(app, state);
}

fn gemini_sorry_navigation_active(provider: &str, url: &tauri::Url) -> bool {
    provider == "gemini"
        && url.scheme() == "https"
        && url.host_str() == Some("www.google.com")
        && (url.path() == "/sorry" || url.path().starts_with("/sorry/"))
}

/// Tauri's macOS on_navigation hook is also invoked for auxiliary challenge
/// frame navigations, not just top-level provider changes. Claude's *working*
/// nonblocking login audit showed about: documents and newassets.hcaptcha.com
/// were denied; hCaptcha documents that this is one of its real asset hosts.
///
/// Keep this exception exact and Claude-only. Do not relax the general
/// cross-provider navigation policy or allow all external websites.
fn challenge_auxiliary_navigation_allowed(provider: &str, url: &tauri::Url) -> bool {
    if provider == "grok" {
        return url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc");
    }
    if provider != "claude" {
        return false;
    }
    if url.scheme() == "about" {
        return url.host_str().is_none()
            && url.query().is_none()
            && matches!(url.path(), "blank" | "srcdoc");
    }
    url.scheme() == "https"
        && url.host_str() == Some("newassets.hcaptcha.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn grok_external_auth_handoff_needs_app_return(provider: &str, url: &tauri::Url) -> bool {
    provider == "grok"
        && url.scheme() == "https"
        && url.host_str() == Some("auth.x.ai")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn schedule_grok_external_auth_return(app: &AppHandle, provider: &str, url: &tauri::Url) {
    if !grok_external_auth_handoff_needs_app_return(provider, url) {
        return;
    }
    let observed_epoch = current_grok_document_epoch(provider);
    if observed_epoch == 0 {
        return;
    }
    let Ok(recovery_webview) = get_provider_webview(app, provider) else {
        return;
    };
    let recovery_provider = provider.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(GROK_EXTERNAL_AUTH_RETURN_DELAY_MS)).await;
        recover_grok_after_external_auth_handoff(
            &recovery_webview,
            &recovery_provider,
            observed_epoch,
        );
    });
}

fn provider_show_should_focus(focus: Option<bool>) -> bool {
    focus.unwrap_or(false)
}

#[derive(Debug, Clone, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProviderState {
    pub provider: String,
    pub webview: String,
    pub dom: String,
    pub login: String,
    pub thinking: bool,
    #[serde(rename = "lastStatusAt")]
    pub last_status_at: u64,
    pub bridge: String,
    #[serde(rename = "bridgeReason")]
    pub bridge_reason: Option<String>,
    pub adapter: String,
}

#[derive(Default)]
struct ProviderRuntime {
    states: HashMap<String, ProviderState>,
    engine_boot: HashMap<String, String>,
    bridge_boot: HashMap<String, String>,
    status_boot: HashMap<String, String>,
    grok_document_epoch: HashMap<String, u64>,
    grok_app_title_epoch: HashMap<String, u64>,
    grok_adopted_boot: HashMap<String, (u64, String)>,
    grok_pending_navigation: HashMap<String, GrokNavigationPreparation>,
    pending_session_boot: HashMap<String, Option<String>>,
    last_push_ms: HashMap<String, u64>,
    stale_check_sent: HashMap<String, u64>,
    watchdog_started: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrokNavigationOwner {
    Lifecycle,
    PopupReserved,
    PopupClaimed,
}

#[derive(Debug, Clone)]
struct GrokPopupRecoveryRollback {
    state: ProviderState,
    engine_boot: Option<String>,
    bridge_boot: Option<String>,
    last_push_ms: Option<u64>,
    stale_check_sent: Option<u64>,
}

#[derive(Debug, Clone)]
struct GrokNavigationPreparation {
    epoch: u64,
    previous_epoch: u64,
    previous_adopted_boot: Option<(u64, String)>,
    previous_status_boot: Option<String>,
    owner: GrokNavigationOwner,
    popup_rollback: Option<GrokPopupRecoveryRollback>,
}

static RUNTIME: OnceLock<Mutex<ProviderRuntime>> = OnceLock::new();

fn runtime() -> &'static Mutex<ProviderRuntime> {
    RUNTIME.get_or_init(|| Mutex::new(ProviderRuntime::default()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrokBridgeDriveOutcome {
    Challenge,
    Installed,
    Present,
    Waiting,
    Retry,
    Ineligible,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GrokBridgeDriveResult {
    outcome: GrokBridgeDriveOutcome,
    boot_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrokBridgeHostAction {
    Ignore,
    MarkBlocked,
}

fn prepare_grok_navigation(provider: &str) -> Result<u64, String> {
    if provider != "grok" {
        return Ok(0);
    }
    let mut guard = runtime()
        .lock()
        .map_err(|_| "provider state poisoned".to_string())?;
    prepare_grok_navigation_locked(&mut guard, provider)
        .ok_or_else(|| format!("provider navigation is already in progress: {provider}"))
}

fn prepare_grok_navigation_locked(guard: &mut ProviderRuntime, provider: &str) -> Option<u64> {
    if let Some(pending) = guard.grok_pending_navigation.get_mut(provider) {
        if pending.owner == GrokNavigationOwner::PopupReserved {
            pending.owner = GrokNavigationOwner::Lifecycle;
            return Some(pending.epoch);
        }
        return None;
    }
    Some(insert_grok_navigation_locked(
        guard,
        provider,
        GrokNavigationOwner::Lifecycle,
    ))
}

fn insert_grok_navigation_locked(
    guard: &mut ProviderRuntime,
    provider: &str,
    owner: GrokNavigationOwner,
) -> u64 {
    let previous_epoch = guard
        .grok_document_epoch
        .get(provider)
        .copied()
        .unwrap_or_default();
    let previous_adopted_boot = guard.grok_adopted_boot.remove(provider);
    let previous_status_boot = guard.status_boot.get(provider).cloned();
    let next_epoch = previous_epoch.saturating_add(1);
    guard.grok_pending_navigation.insert(
        provider.to_string(),
        GrokNavigationPreparation {
            epoch: next_epoch,
            previous_epoch,
            previous_adopted_boot,
            previous_status_boot,
            owner,
            popup_rollback: None,
        },
    );
    next_epoch
}

fn grok_auth_popup_may_complete_login(provider: &str, url: &tauri::Url) -> bool {
    if provider != "grok" || !adapters::url_allowed_for_sso(provider, url).unwrap_or(false) {
        return false;
    }
    !url.host_str().is_some_and(|host| {
        host == "challenges.cloudflare.com" || host.ends_with(".challenges.cloudflare.com")
    })
}

fn grok_popup_recovery_needed(
    state: &ProviderState,
    observed_epoch: u64,
    current_epoch: u64,
    navigation_pending: bool,
) -> bool {
    state.provider == "grok"
        && state.webview == "loaded"
        && state.dom == "unknown"
        && state.login == "blocked"
        && observed_epoch != 0
        && observed_epoch == current_epoch
        && !navigation_pending
}

fn prepare_grok_popup_recovery(provider: &str, observed_epoch: u64) -> Option<u64> {
    let Ok(mut guard) = runtime().lock() else {
        return None;
    };
    let current_epoch = guard
        .grok_document_epoch
        .get(provider)
        .copied()
        .unwrap_or_default();
    let state = guard.states.get(provider)?.clone();
    if !grok_popup_recovery_needed(
        &state,
        observed_epoch,
        current_epoch,
        guard.grok_pending_navigation.contains_key(provider),
    ) {
        return None;
    }
    Some(insert_grok_navigation_locked(
        &mut guard,
        provider,
        GrokNavigationOwner::PopupReserved,
    ))
}

fn prepare_grok_external_auth_return(provider: &str, observed_epoch: u64) -> Option<u64> {
    if provider != "grok" || observed_epoch == 0 {
        return None;
    }
    let Ok(mut guard) = runtime().lock() else {
        return None;
    };
    if guard.grok_document_epoch.get(provider).copied() != Some(observed_epoch)
        || guard.grok_pending_navigation.contains_key(provider)
    {
        return None;
    }
    Some(insert_grok_navigation_locked(
        &mut guard,
        provider,
        GrokNavigationOwner::Lifecycle,
    ))
}

fn grok_external_auth_return_is_current(
    provider: &str,
    observed_epoch: u64,
    prepared_epoch: u64,
) -> bool {
    provider == "grok"
        && observed_epoch != 0
        && prepared_epoch != 0
        && runtime().lock().ok().is_some_and(|guard| {
            guard.grok_document_epoch.get(provider).copied() == Some(observed_epoch)
                && guard
                    .grok_pending_navigation
                    .get(provider)
                    .is_some_and(|pending| {
                        pending.owner == GrokNavigationOwner::Lifecycle
                            && pending.previous_epoch == observed_epoch
                            && pending.epoch == prepared_epoch
                    })
        })
}

fn claim_grok_popup_recovery(provider: &str, observed_epoch: u64, prepared_epoch: u64) -> bool {
    let Ok(mut guard) = runtime().lock() else {
        return false;
    };
    let Some(pending) = guard.grok_pending_navigation.get(provider) else {
        return false;
    };
    if pending.owner != GrokNavigationOwner::PopupReserved
        || pending.epoch != prepared_epoch
        || pending.previous_epoch != observed_epoch
    {
        return false;
    }
    let current_epoch = guard
        .grok_document_epoch
        .get(provider)
        .copied()
        .unwrap_or_default();
    let Some(previous_state) = guard.states.get(provider).cloned() else {
        return false;
    };
    if !grok_popup_recovery_needed(&previous_state, observed_epoch, current_epoch, false) {
        return false;
    }

    let rollback = GrokPopupRecoveryRollback {
        state: previous_state.clone(),
        engine_boot: guard.engine_boot.remove(provider),
        bridge_boot: guard.bridge_boot.remove(provider),
        last_push_ms: guard.last_push_ms.remove(provider),
        stale_check_sent: guard.stale_check_sent.remove(provider),
    };
    let mut next_state = previous_state;
    reset_state_for_page_load(&mut next_state);
    guard.states.insert(provider.to_string(), next_state);
    let Some(pending) = guard.grok_pending_navigation.get_mut(provider) else {
        return false;
    };
    pending.owner = GrokNavigationOwner::PopupClaimed;
    pending.popup_rollback = Some(rollback);
    true
}

fn grok_popup_recovery_claim_is_current(provider: &str, prepared_epoch: u64) -> bool {
    runtime().lock().ok().is_some_and(|guard| {
        let Some(pending) = guard.grok_pending_navigation.get(provider) else {
            return false;
        };
        pending.owner == GrokNavigationOwner::PopupClaimed
            && pending.epoch == prepared_epoch
            && guard.grok_document_epoch.get(provider).copied() == Some(pending.previous_epoch)
            && guard.states.get(provider).is_some_and(|state| {
                grok_popup_recovery_needed(
                    state,
                    pending.previous_epoch,
                    pending.previous_epoch,
                    false,
                )
            })
    })
}

fn confirm_grok_page_load(provider: &str) -> u64 {
    if provider != "grok" {
        return 0;
    }
    let Ok(mut guard) = runtime().lock() else {
        return 0;
    };
    if let Some(pending) = guard.grok_pending_navigation.remove(provider) {
        guard
            .grok_document_epoch
            .insert(provider.to_string(), pending.epoch);
        guard.grok_adopted_boot.remove(provider);
        return pending.epoch;
    }
    guard.grok_adopted_boot.remove(provider);
    let epoch = guard
        .grok_document_epoch
        .entry(provider.to_string())
        .or_default();
    *epoch = epoch.saturating_add(1);
    *epoch
}

fn cancel_grok_navigation_owned(
    provider: &str,
    prepared_epoch: u64,
    expected_owners: &[GrokNavigationOwner],
) {
    if provider != "grok" || prepared_epoch == 0 {
        return;
    }
    let Ok(mut guard) = runtime().lock() else {
        return;
    };
    let Some(pending) = guard.grok_pending_navigation.get(provider).cloned() else {
        return;
    };
    if pending.epoch != prepared_epoch || !expected_owners.contains(&pending.owner) {
        return;
    }
    if guard
        .grok_document_epoch
        .get(provider)
        .copied()
        .unwrap_or_default()
        != pending.previous_epoch
    {
        return;
    }
    guard.grok_pending_navigation.remove(provider);
    if pending.owner == GrokNavigationOwner::Lifecycle {
        guard.pending_session_boot.remove(provider);
    }
    if let Some(rollback) = pending.popup_rollback {
        guard.states.insert(provider.to_string(), rollback.state);
        match rollback.engine_boot {
            Some(previous) => {
                guard.engine_boot.insert(provider.to_string(), previous);
            }
            None => {
                guard.engine_boot.remove(provider);
            }
        }
        match rollback.bridge_boot {
            Some(previous) => {
                guard.bridge_boot.insert(provider.to_string(), previous);
            }
            None => {
                guard.bridge_boot.remove(provider);
            }
        }
        match rollback.last_push_ms {
            Some(previous) => {
                guard.last_push_ms.insert(provider.to_string(), previous);
            }
            None => {
                guard.last_push_ms.remove(provider);
            }
        }
        match rollback.stale_check_sent {
            Some(previous) => {
                guard
                    .stale_check_sent
                    .insert(provider.to_string(), previous);
            }
            None => {
                guard.stale_check_sent.remove(provider);
            }
        }
    }
    match pending.previous_adopted_boot {
        Some(previous) => {
            guard
                .grok_adopted_boot
                .insert(provider.to_string(), previous);
        }
        None => {
            guard.grok_adopted_boot.remove(provider);
        }
    }
    match pending.previous_status_boot {
        Some(previous) => {
            guard.status_boot.insert(provider.to_string(), previous);
        }
        None => {
            guard.status_boot.remove(provider);
        }
    }
}

fn cancel_grok_navigation(provider: &str, prepared_epoch: u64) {
    cancel_grok_navigation_owned(provider, prepared_epoch, &[GrokNavigationOwner::Lifecycle]);
}

fn cancel_grok_popup_recovery(provider: &str, prepared_epoch: u64) {
    cancel_grok_navigation_owned(
        provider,
        prepared_epoch,
        &[
            GrokNavigationOwner::PopupReserved,
            GrokNavigationOwner::PopupClaimed,
        ],
    );
}

fn expire_grok_navigation_start_lease(
    provider: &str,
    prepared_epoch: u64,
    owner: GrokNavigationOwner,
) {
    cancel_grok_navigation_owned(provider, prepared_epoch, &[owner]);
}

fn schedule_grok_navigation_start_lease(
    provider: &str,
    prepared_epoch: u64,
    owner: GrokNavigationOwner,
) {
    if provider != "grok" || prepared_epoch == 0 {
        return;
    }
    let provider = provider.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(GROK_NAVIGATION_START_LEASE_MS)).await;
        expire_grok_navigation_start_lease(&provider, prepared_epoch, owner);
    });
}

fn retire_grok_document(provider: &str) {
    if provider != "grok" {
        return;
    }
    let Ok(mut guard) = runtime().lock() else {
        return;
    };
    guard.grok_pending_navigation.remove(provider);
    guard.grok_adopted_boot.remove(provider);
    guard.grok_app_title_epoch.remove(provider);
    let epoch = guard
        .grok_document_epoch
        .entry(provider.to_string())
        .or_default();
    *epoch = epoch.saturating_add(1);
}

fn adopt_grok_bridge_boot(provider: &str, observed_epoch: u64, boot_id: &str) -> bool {
    if provider != "grok" || observed_epoch == 0 || boot_id.is_empty() {
        return false;
    }
    let Ok(mut guard) = runtime().lock() else {
        return false;
    };
    if guard.grok_document_epoch.get(provider).copied() != Some(observed_epoch) {
        return false;
    }
    if guard.grok_pending_navigation.contains_key(provider) {
        return false;
    }
    guard
        .grok_adopted_boot
        .insert(provider.to_string(), (observed_epoch, boot_id.to_string()));
    true
}

fn grok_bridge_result_is_current(provider: &str, observed_epoch: u64) -> bool {
    provider == "grok"
        && observed_epoch != 0
        && runtime().lock().ok().is_some_and(|guard| {
            guard.grok_document_epoch.get(provider).copied() == Some(observed_epoch)
                && !guard.grok_pending_navigation.contains_key(provider)
        })
}

fn grok_bridge_boot_is_current(provider: &str, boot_id: Option<&str>) -> bool {
    if provider != "grok" {
        return true;
    }
    let Some(boot_id) = boot_id else {
        return false;
    };
    runtime().lock().ok().is_some_and(|guard| {
        let current_epoch = guard
            .grok_document_epoch
            .get(provider)
            .copied()
            .unwrap_or_default();
        guard
            .grok_adopted_boot
            .get(provider)
            .is_some_and(|(epoch, adopted_boot)| *epoch == current_epoch && adopted_boot == boot_id)
    })
}

fn current_grok_document_epoch(provider: &str) -> u64 {
    runtime()
        .lock()
        .ok()
        .and_then(|guard| guard.grok_document_epoch.get(provider).copied())
        .unwrap_or_default()
}

fn set_grok_app_title_signal(provider: &str, observed_epoch: u64, active: bool) {
    if provider != "grok" {
        return;
    }
    if let Ok(mut guard) = runtime().lock() {
        if active && observed_epoch != 0 {
            guard
                .grok_app_title_epoch
                .insert(provider.to_string(), observed_epoch);
        } else {
            guard.grok_app_title_epoch.remove(provider);
        }
    }
}

fn grok_app_title_signal_is_current(provider: &str, observed_epoch: u64) -> bool {
    provider == "grok"
        && observed_epoch != 0
        && runtime().lock().ok().is_some_and(|guard| {
            guard.grok_app_title_epoch.get(provider).copied() == Some(observed_epoch)
        })
}

fn should_drive_grok_bridge(state: &ProviderState) -> bool {
    state.provider == "grok" && state.webview == "loaded" && state.dom != "ready"
}

fn should_drive_grok_bridge_from_background(
    state: &ProviderState,
    app_title_signal_is_current: bool,
) -> bool {
    should_drive_grok_bridge(state) && app_title_signal_is_current
}

fn generic_staleness_dispatch_allowed(
    state: &ProviderState,
    app_title_signal_is_current: bool,
) -> bool {
    state.provider != "grok" || app_title_signal_is_current
}

fn grok_reconnect_allowed(state: &ProviderState, now_ms: u64) -> bool {
    state.provider == "grok"
        && state.webview == "loaded"
        && state.dom == "unknown"
        && matches!(state.login.as_str(), "unknown" | "logged_in")
        && !state.thinking
        && state.bridge == "ok"
        && state.adapter == "ok"
        && now_ms.saturating_sub(state.last_status_at) > STATUS_EXPIRED_MS
}

fn grok_stale_reason(
    state: &ProviderState,
    now_ms: u64,
    app_title_signal_is_current: bool,
) -> Option<&'static str> {
    (!app_title_signal_is_current
        && state.bridge_reason.is_none()
        && grok_reconnect_allowed(state, now_ms))
    .then_some(GROK_APP_TITLE_UNCONFIRMED_REASON)
}

fn provider_document_allows_generic_eval(
    provider: &str,
    url_matches_app: bool,
    state: Option<&ProviderState>,
    current_epoch: u64,
    app_title_epoch: Option<u64>,
    adopted_boot_epoch: Option<u64>,
    navigation_pending: bool,
) -> bool {
    if !url_matches_app {
        return false;
    }
    if provider != "grok" {
        return true;
    }
    let Some(state) = state else {
        return false;
    };
    current_epoch != 0
        && app_title_epoch == Some(current_epoch)
        && adopted_boot_epoch == Some(current_epoch)
        && !navigation_pending
        && state.login != "blocked"
}

fn provider_state_allows_control_eval(state: &ProviderState) -> bool {
    state.webview == "loaded" && state.dom == "ready" && state.login != "blocked"
}

fn grok_bridge_drive_allowed(state: &ProviderState) -> bool {
    state.provider == "grok"
        && matches!(state.webview.as_str(), "creating" | "loaded")
        && state.dom != "ready"
}

fn grok_bridge_host_action(
    outcome: GrokBridgeDriveOutcome,
    observed_epoch: u64,
    current_epoch: u64,
    current_state: &ProviderState,
) -> GrokBridgeHostAction {
    if observed_epoch == 0
        || observed_epoch != current_epoch
        || !grok_bridge_drive_allowed(current_state)
    {
        return GrokBridgeHostAction::Ignore;
    }
    match outcome {
        GrokBridgeDriveOutcome::Challenge => GrokBridgeHostAction::MarkBlocked,
        GrokBridgeDriveOutcome::Installed
        | GrokBridgeDriveOutcome::Present
        | GrokBridgeDriveOutcome::Waiting
        | GrokBridgeDriveOutcome::Retry
        | GrokBridgeDriveOutcome::Ineligible => GrokBridgeHostAction::Ignore,
    }
}

fn record_grok_bridge_challenge(provider: &str, observed_epoch: u64) -> Option<ProviderState> {
    let Ok(mut guard) = runtime().lock() else {
        return None;
    };
    let current_epoch = guard
        .grok_document_epoch
        .get(provider)
        .copied()
        .unwrap_or_default();
    let current_state = guard.states.get(provider)?.clone();
    if grok_bridge_host_action(
        GrokBridgeDriveOutcome::Challenge,
        observed_epoch,
        current_epoch,
        &current_state,
    ) != GrokBridgeHostAction::MarkBlocked
    {
        return None;
    }
    guard.grok_app_title_epoch.remove(provider);
    let mut next_state = current_state;
    next_state.webview = "loaded".into();
    next_state.dom = "unknown".into();
    next_state.login = "blocked".into();
    next_state.thinking = false;
    next_state.last_status_at = now_ms();
    next_state.bridge_reason = None;
    guard
        .states
        .insert(provider.to_string(), next_state.clone());
    Some(next_state)
}

fn parse_grok_bridge_drive_outcome(raw: &str) -> Option<GrokBridgeDriveResult> {
    let mut value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    let value = match value {
        serde_json::Value::String(nested) => {
            value = serde_json::from_str::<serde_json::Value>(&nested)
                .unwrap_or(serde_json::Value::String(nested));
            value
        }
        value => value,
    };
    let (outcome, boot_id) = match value {
        serde_json::Value::String(outcome) => (outcome, None),
        serde_json::Value::Object(mut result) => (
            result.remove("outcome")?.as_str()?.to_string(),
            result
                .remove("bootId")
                .and_then(|value| value.as_str().map(str::to_string)),
        ),
        _ => return None,
    };
    let outcome = match outcome.as_str() {
        "challenge" => GrokBridgeDriveOutcome::Challenge,
        "installed" => GrokBridgeDriveOutcome::Installed,
        "present" => GrokBridgeDriveOutcome::Present,
        "waiting" => GrokBridgeDriveOutcome::Waiting,
        "retry" => GrokBridgeDriveOutcome::Retry,
        "ineligible" => GrokBridgeDriveOutcome::Ineligible,
        _ => return None,
    };
    Some(GrokBridgeDriveResult { outcome, boot_id })
}

fn apply_grok_bridge_drive_outcome(
    app: &AppHandle,
    provider: &str,
    observed_epoch: u64,
    result: GrokBridgeDriveResult,
) {
    if !grok_bridge_result_is_current(provider, observed_epoch) {
        return;
    }
    if matches!(
        result.outcome,
        GrokBridgeDriveOutcome::Installed | GrokBridgeDriveOutcome::Present
    ) {
        let Some(boot_id) = result.boot_id.as_deref() else {
            return;
        };
        if !adopt_grok_bridge_boot(provider, observed_epoch, boot_id) {
            return;
        }
        // The atomic delayed driver observed no challenge and installed a current bridge. Clear
        // the stale blocked UI state before routing ordinary bridge traffic through the guarded
        // generic-eval path.
        clear_provider_challenge_blocked(app, provider);
        let check = serde_json::json!({
            "v": 1,
            "action": "CHECK_STATUS",
            "provider": provider
        });
        let script = format!(
            "window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch({});",
            serde_json::to_string(&check).unwrap_or_default()
        );
        let _ = eval_provider(app, provider, &script);
        return;
    }
    if result.outcome != GrokBridgeDriveOutcome::Challenge {
        return;
    }
    let Some(next_state) = record_grok_bridge_challenge(provider, observed_epoch) else {
        return;
    };
    let _ = app.emit_to("main", "connections://update", &next_state);
}

fn drive_grok_bridge_on_webview(
    webview: &tauri::Webview,
    app: &AppHandle,
    provider: &str,
    script: &str,
    observed_epoch: u64,
) {
    if !grok_bridge_result_is_current(provider, observed_epoch) {
        return;
    }
    let app = app.clone();
    let provider = provider.to_string();
    let _ = webview.eval_with_callback(script, move |raw| {
        if let Some(result) = parse_grok_bridge_drive_outcome(&raw) {
            apply_grok_bridge_drive_outcome(&app, &provider, observed_epoch, result);
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NewWindowAction {
    /// OAuth / allowlisted window.open hosted in a decorated Tauri window.
    AllowPopup,
    /// Emit nav://blocked + open system browser, then Deny.
    DenyExternal,
    /// Silent Deny (sentinel / non-http).
    DenySilent,
}

/// Provider-generated links are not user clicks. Do not launch the system
/// browser when Gemini, ChatGPT or Claude request disallowed popups/redirects.
/// The sole automatic fallback is the explicitly verified Grok auth return;
/// allowlisted Google/other SSO popups are still hosted inside Tauri.
fn external_handoff_allowed(provider: &str, url: &tauri::Url) -> bool {
    grok_external_auth_handoff_needs_app_return(provider, url)
}

/// Auxiliary ChatGPT reply renderers belong inside their existing page/iframe.
/// Never open one as a top-level system browser tab or native auth popup.
fn chatgpt_renderer_auxiliary_url(provider: &str, url: &tauri::Url) -> bool {
    provider == "chatgpt"
        && url.scheme() == "https"
        && url.host_str() == Some("cdn.platform.openai.com")
        && url.path().starts_with("/deployments/dil/")
        && url.path().ends_with("/runner.html")
}

/// WKWebView reports the DIL iframe's navigation through the URL-only
/// on_navigation callback. The provider's current *top-level* URL must remain
/// the trusted ChatGPT application before permitting this exact CDN runner.
/// A second guard at page-load completion restores the trusted app if the
/// runner nevertheless became the top-level document.
fn allow_chatgpt_renderer_navigation(
    provider: &str,
    target: &tauri::Url,
    current_main_url: &tauri::Url,
) -> bool {
    chatgpt_renderer_auxiliary_url(provider, target)
        && adapters::url_matches_provider_app(provider, current_main_url).unwrap_or(false)
}

fn chatgpt_renderer_replaced_top_level(
    provider: &str,
    loaded_url: &tauri::Url,
    current_main_url: &tauri::Url,
) -> bool {
    chatgpt_renderer_auxiliary_url(provider, loaded_url)
        && chatgpt_renderer_auxiliary_url(provider, current_main_url)
}

const MAX_PROVIDER_POPUPS: usize = 8;

fn provider_popup_budget_available(count: usize) -> bool {
    count < MAX_PROVIDER_POPUPS
}

// Popups are *not* trusted just because their first URL was an allowed IdP.
// Recheck every subsequent navigation to avoid redirecting the native auth
// browser to arbitrary HTTPS or local pages.
fn provider_popup_navigation_allowed(provider: &str, url: &tauri::Url) -> bool {
    if url.scheme() == "about" {
        return matches!(url.path(), "blank" | "srcdoc");
    }
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    challenge_auxiliary_navigation_allowed(provider, url)
        || adapters::url_allowed_for_provider(provider, url).unwrap_or(false)
        || adapters::url_allowed_for_sso(provider, url).unwrap_or(false)
}

fn decide_new_window_action(url: &tauri::Url, allowlisted: bool) -> NewWindowAction {
    if url.host_str() == Some("mac-bridge.invalid") {
        return NewWindowAction::DenySilent;
    }
    // Never let a caller's allowlisted hint bypass URL scheme/authority checks.
    if allowlisted
        && url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
    {
        return NewWindowAction::AllowPopup;
    }
    if url.scheme() == "https" || url.scheme() == "http" {
        return NewWindowAction::DenyExternal;
    }
    NewWindowAction::DenySilent
}

fn popup_initial_title(url: &tauri::Url) -> &str {
    url.host_str().unwrap_or("Sign in")
}

fn physical_bounds(bounds: &Bounds) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    fn position(value: f64, name: &str) -> Result<i32, String> {
        if !value.is_finite() {
            return Err(format!("invalid webview bounds: {name} must be finite"));
        }
        let rounded = value.round();
        if rounded < i32::MIN as f64 || rounded > i32::MAX as f64 {
            return Err(format!("invalid webview bounds: {name} is out of range"));
        }
        Ok(rounded as i32)
    }

    fn size(value: f64, name: &str) -> Result<u32, String> {
        if !value.is_finite() {
            return Err(format!("invalid webview bounds: {name} must be finite"));
        }
        let rounded = value.round();
        if rounded < 1.0 || rounded > u32::MAX as f64 {
            return Err(format!(
                "invalid webview bounds: {name} must round to a positive u32"
            ));
        }
        Ok(rounded as u32)
    }

    Ok((
        PhysicalPosition::new(position(bounds.x, "x")?, position(bounds.y, "y")?),
        PhysicalSize::new(size(bounds.width, "width")?, size(bounds.height, "height")?),
    ))
}


/** Create a dedicated native host BEFORE creating the provider WebView.
 * macOS WKWebView can retain the old AppKit frame after reparenting. A provider
 * born inside a full-size standalone NSWindow avoids that move entirely.
 * Keep the window (and its one cookie/session profile) for the app's lifetime.
 */
fn ensure_provider_page_window(
    app: &AppHandle,
    provider: &str,
) -> Result<tauri::Window, String> {
    let label = provider_page_window_label(provider);
    if let Some(window) = app.get_window(&label) {
        return Ok(window);
    }
    let window = WindowBuilder::new(app, label)
        .title(format!("{} — Multi-Model Workbench", provider.to_uppercase()))
        .inner_size(940.0, 700.0)
        .min_inner_size(520.0, 380.0)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    let close_app = app.clone();
    let close_provider = provider.to_string();
    let close_window = window.clone();
    window.on_window_event(move |event| {
        #[cfg(target_os = "macos")]
        if close_provider == "claude" && matches!(event, tauri::WindowEvent::Resized(_)) {
            claude_login_tabs::layout(&close_app, &close_window);
        }
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Do not destroy and recreate the authenticated WebView. Hiding its
            // host preserves the existing bridge/session for future workflows.
            api.prevent_close();
            let _ = close_window.hide();
            let _ = close_app.emit_to(
                "main",
                "provider-window://closed",
                close_provider.clone(),
            );
        }
    });
    Ok(window)
}

#[tauri::command]
pub async fn provider_open(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    bounds: Bounds,
) -> Result<ProviderState, String> {
    ensure_control_webview(&webview)?;
    // Preserve validation of the trusted UI's legacy bounds argument, but
    // never use those panel coordinates to size the separately hosted page.
    let _ = physical_bounds(&bounds)?;
    let adapter = adapters::get_adapter(&provider)?;
    // Serialize provider creation with standby changes. Otherwise settings_set could select this
    // provider as standby after the first active check but before add_child registers the WebView.
    let _lifecycle_guard = settings::lock_provider_lifecycle()?;
    settings::ensure_provider_active_locked(&app, &provider)?;
    let label = provider_label(&provider);
    if let Some(webview) = app.get_webview(&label) {
        if !is_provider_detached(&webview, &provider) {
            return Err(format!("{provider} is attached to an unexpected host window"));
        }
        return Ok(current_state(&provider));
    }
    start_staleness_watchdog(&app);
    set_state(
        &app,
        state_with(&provider, "creating", "unknown", "unknown", false),
    );

    // WebView ownership is established once, here. No reparenting to/from
    // the workbench: the provider runs in this native window even when hidden.
    let window = ensure_provider_page_window(&app, &provider)?;
    #[cfg(target_os = "macos")]
    if provider == "claude" {
        claude_login_tabs::ensure_toolbar(&app, &window)?;
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let profile_dir = app_data.join("webviews").join(&provider);
    std::fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    let url = adapter
        .urls
        .app
        .parse()
        .map_err(|error| format!("invalid provider URL: {error}"))?;

    let init_script = format!(
        "window.__MAC_PROVIDER__ = {};\nwindow.__MAC_APP_HOSTS__ = {};\n{}",
        serde_json::to_string(&provider).map_err(|error| error.to_string())?,
        serde_json::to_string(&adapters::app_hosts_for_provider(&provider)?)
            .map_err(|error| error.to_string())?,
        BOOTSTRAP_JS
    );
    let delayed_grok_script = if provider == "grok" {
        Some(delayed_grok_bridge_script(&provider)?)
    } else {
        None
    };
    let nav_app = app.clone();
    let nav_provider = provider.clone();
    let popup_app = app.clone();
    let popup_provider = provider.clone();
    // Inbound-hint transport: the document.title codec (SPEC §7). Cross-platform via Tauri's
    // WebviewBuilder hook — wry implements the underlying observer natively on WebView2 (Windows),
    // WKWebView KVO (macOS), and WebKitGTK (Linux), and it fires for child webviews. This replaces
    // the old Windows-only `register_title_watcher` (whose non-Windows branch was a no-op stub).
    let title_app = app.clone();
    let title_provider = provider.clone();
    let title_delayed_grok_script = delayed_grok_script.clone();
    let load_app = app.clone();
    let load_provider = provider.clone();
    let load_delayed_grok_script = delayed_grok_script;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url));
    // Grok's Cloudflare challenge must see a stock document from its first instruction.
    // Install the automation bridge only after the real app page is confirmed below.
    let builder = if provider_uses_document_start_bridge(&provider) {
        builder.initialization_script(&init_script)
    } else {
        builder
    };
    // Cloudflare Turnstile requires standard, unmodified browser APIs in embedded WebViews.
    // Grok is Cloudflare-protected, so do not monkey-patch navigator.permissions,
    // Notification, or geolocation in its top page or challenge frames.
    let builder = if provider_uses_permission_shim(&provider) {
        builder.initialization_script_for_all_frames(PERMISSION_SHIM_JS)
    } else {
        builder
    };
    // Every provider is parked offscreen outside its active pane. Preserve the shipped liveness
    // tuning so provider timers and renderers keep running while hidden.
    let builder = builder.data_directory(profile_dir);
    // macOS Claude uses a 48pt local tab strip above the provider child.
    // Auto-resize otherwise stretches the provider across that strip.
    #[cfg(target_os = "macos")]
    let builder = if provider == "claude" { builder } else { builder.auto_resize() };
    #[cfg(not(target_os = "macos"))]
    let builder = builder.auto_resize();
    let builder = builder.background_throttling(BackgroundThrottlingPolicy::Disabled)
        .additional_browser_args(PROVIDER_BROWSER_ARGS)
        .on_document_title_changed(move |webview, title| {
            let document_epoch = current_grok_document_epoch(&title_provider);
            handle_provider_document_title(&title_app, &title_provider, &title);
            // A successful magic-link login can transition to /new via the
            // site's client-side router without a full page-load callback.
            // Only a validated conversation route may launch the read-only
            // composer probe, and no script runs on login/account pages.
            if title_provider == "claude"
                && !title.starts_with("\u{200B}MAC1|")
                && current_state("claude").dom != "ready"
                && webview.url().ok().is_some_and(|url| claude_conversation_url(&url))
            {
                schedule_claude_bridge_install(&title_app, &webview);
            }
            let Some(title_signal) = webview
                .url()
                .ok()
                .map(|url| grok_document_title_signal(&title_provider, &title, &url))
            else {
                return;
            };
            match title_signal {
                GrokDocumentTitleSignal::Ignore => return,
                GrokDocumentTitleSignal::Challenge => {
                    set_grok_app_title_signal(&title_provider, document_epoch, false);
                    // The title alone proves a challenge document is active. Mark it blocked from
                    // host state only — evaluating the probe script into the challenge document is
                    // itself the tampering Turnstile rejects, and each rejection reissues the
                    // challenge with a fresh Ray ID (an unrecoverable loop).
                    set_provider_challenge_blocked(&title_app, &title_provider);
                    return;
                }
                GrokDocumentTitleSignal::App => {
                    // Persist the positive host-side title signal for this document epoch. Only
                    // then may page-load or watchdog retries evaluate the delayed bridge driver.
                    set_grok_app_title_signal(&title_provider, document_epoch, true);
                }
            }
            if !grok_bridge_drive_allowed(&current_state(&title_provider)) {
                return;
            }
            let Some(script) = title_delayed_grok_script.as_deref() else {
                return;
            };

            // Use this event's WebView directly: title events may arrive before the child is
            // discoverable through AppHandle's webview registry. The driver probes and installs
            // atomically in one JavaScript task.
            drive_grok_bridge_on_webview(
                &webview,
                &title_app,
                &title_provider,
                script,
                document_epoch,
            );
        })
        .on_page_load(move |webview, payload| {
            match payload.event() {
                PageLoadEvent::Started => {
                    if chatgpt_renderer_auxiliary_url(&load_provider, payload.url()) {
                        return;
                    }
                    if load_provider == "grok" {
                        confirm_grok_page_load(&load_provider);
                    }
                    reset_bridge_state(&load_app, &load_provider);
                }
                PageLoadEvent::Finished => {
                    if chatgpt_renderer_auxiliary_url(&load_provider, payload.url()) {
                        // A subframe load leaves Webview::url() on chatgpt.com.
                        // If the actual top-level URL became the CDN runner,
                        // restore the provider instead of hosting it as the app.
                        let top_level_replaced = webview
                            .url()
                            .ok()
                            .is_some_and(|main_url| {
                                chatgpt_renderer_replaced_top_level(
                                    &load_provider,
                                    payload.url(),
                                    &main_url,
                                )
                            });
                        if top_level_replaced {
                            let _ = load_app.emit_to(
                                "main",
                                "bridge://msg",
                                serde_json::json!({
                                    "v": 1,
                                    "action": "STATUS_REPORT",
                                    "provider": &load_provider,
                                    "transport": "local",
                                    "payload": { "rendererDiagnostic": "top-level-recovered" }
                                }),
                            );
                            if let Ok(adapter) = adapters::get_adapter(&load_provider) {
                                if let Ok(app_url) = tauri::Url::parse(&adapter.urls.app) {
                                    let _ = webview.navigate(app_url);
                                }
                            }
                        }
                        return;
                    }
                    if load_provider != "grok" {
                        if load_provider == "claude"
                            && claude_conversation_url(payload.url())
                        {
                            schedule_claude_bridge_install(&load_app, &webview);
                        }
                        if load_provider == "chatgpt"
                            && adapters::url_matches_provider_app(&load_provider, payload.url())
                                .unwrap_or(false)
                        {
                            let _ = recover_regular_provider_bridge(&load_app, &load_provider);
                        }
                        return;
                    }
                    let Some(script) = load_delayed_grok_script.as_deref() else {
                        return;
                    };
                    let state = current_state(&load_provider);
                    let document_epoch = current_grok_document_epoch(&load_provider);
                    // While blocked, challenge auto-retries also fire Finished on the grok.com
                    // URL; probing those documents would re-trip Turnstile. The app-title event
                    // is the recovery signal instead. A provider URL alone is insufficient:
                    // page-load may fire before any positive host-side app-title observation.
                    if !adapters::url_matches_provider_app(&load_provider, payload.url())
                        .unwrap_or(false)
                        || !should_drive_grok_bridge_from_background(
                            &state,
                            grok_app_title_signal_is_current(&load_provider, document_epoch),
                        )
                    {
                        return;
                    }
                    drive_grok_bridge_on_webview(
                        &webview,
                        &load_app,
                        &load_provider,
                        script,
                        document_epoch,
                    );
                }
            }
        })
        .on_navigation(move |url| {
            // WKWebView sends the DIL reply iframe through this URL-only
            // callback. Blocking it prevents ChatGPT from rendering answers.
            // Permit only this exact CDN runner while the WebView's top-level
            // document is still an allowed ChatGPT app URL. Renderer popups
            // remain denied; the load callback guards top-level takeover.
            if chatgpt_renderer_auxiliary_url(&nav_provider, url) {
                let current_main_url = get_provider_webview(&nav_app, &nav_provider)
                    .ok()
                    .and_then(|webview| webview.url().ok());
                let allowed = current_main_url.as_ref().is_some_and(|current| {
                    allow_chatgpt_renderer_navigation(&nav_provider, url, current)
                });
                let _ = nav_app.emit_to(
                    "main",
                    "bridge://msg",
                    serde_json::json!({
                        "v": 1,
                        "action": "STATUS_REPORT",
                        "provider": &nav_provider,
                        "transport": "local",
                        "payload": {
                            "rendererDiagnostic": if allowed {
                                "navigation-allowed"
                            } else {
                                "navigation-blocked"
                            }
                        }
                    }),
                );
                return allowed;
            }
            if url.host_str() == Some("mac-bridge.invalid") {
                return false;
            }
            if gemini_sorry_navigation_active(&nav_provider, url) {
                set_provider_challenge_blocked(&nav_app, &nav_provider);
                return true;
            }
            if challenge_auxiliary_navigation_allowed(&nav_provider, url)
                || adapters::url_allowed_for_provider(&nav_provider, url).unwrap_or(false)
                || adapters::url_allowed_for_sso(&nav_provider, url).unwrap_or(false)
            {
                return true;
            }
            if url.scheme() == "https" || url.scheme() == "http" {
                if let Some(host) = url.host_str() {
                    let _ = nav_app.emit_to(
                        "main",
                        "nav://blocked",
                        serde_json::json!({ "provider": &nav_provider, "host": host }),
                    );
                }
                if external_handoff_allowed(&nav_provider, url) {
                    let _ = nav_app.opener().open_url(url.as_str(), None::<&str>);
                    schedule_grok_external_auth_return(&nav_app, &nav_provider, url);
                }
            }
            false
        })
        .on_new_window(move |url, features| {
            if chatgpt_renderer_auxiliary_url(&popup_provider, &url) {
                let _ = popup_app.emit_to(
                    "main",
                    "bridge://msg",
                    serde_json::json!({
                        "v": 1,
                        "action": "STATUS_REPORT",
                        "provider": &popup_provider,
                        "transport": "local",
                        "payload": { "rendererDiagnostic": "popup-blocked" }
                    }),
                );
                return NewWindowResponse::Deny;
            }
            // Challenge auxiliary about: documents are allowed only as in-webview navigation.
            // Keep all non-HTTP(S) popups fail-closed; Turnstile does not require popup windows.
            let provider_allowed =
                adapters::url_allowed_for_provider(&popup_provider, &url).unwrap_or(false);
            let sso_allowed = adapters::url_allowed_for_sso(&popup_provider, &url).unwrap_or(false);
            // Gemini frequently requests provider-app window.open calls while
            // generating. Such duplicated Gemini app windows are not OAuth
            // popups and must not be launched or handed to the system browser.
            // Keep allowlisted Google/Apple SSO windows for explicit login.
            if popup_provider == "gemini" && provider_allowed && !sso_allowed {
                return NewWindowResponse::Deny;
            }
            let allowlisted = provider_allowed || sso_allowed;
            match decide_new_window_action(&url, allowlisted) {
                // Host popups in our own decorated window: the platform-default popup
                // (WebView2) is undecorated, so it can't be dragged off the page it covers.
                // window_features() wires the opener environment, so OAuth flows keep working.
                NewWindowAction::AllowPopup => {
                    // An untrusted page could otherwise flood native popup windows.
                    let open_popups = popup_app.webview_windows().keys()
                        .filter(|label| label.starts_with("provider-popup-"))
                        .count();
                    if !provider_popup_budget_available(open_popups) {
                        return NewWindowResponse::Deny;
                    }
                    let recovery_epoch = grok_auth_popup_may_complete_login(&popup_provider, &url)
                        .then(|| current_grok_document_epoch(&popup_provider));
                    static POPUP_SEQ: AtomicUsize = AtomicUsize::new(0);
                    let label = format!(
                        "provider-popup-{}",
                        POPUP_SEQ.fetch_add(1, Ordering::Relaxed)
                    );
                    let popup_nav_provider = popup_provider.clone();
                    let builder = tauri::WebviewWindowBuilder::new(
                        &popup_app,
                        &label,
                        WebviewUrl::External("about:blank".parse().expect("static url")),
                    )
                    .window_features(features)
                    .on_navigation(move |next| {
                        provider_popup_navigation_allowed(&popup_nav_provider, next)
                    })
                    // Additional OAuth windows require a separately reviewed
                    // workflow rather than unmanaged nested browser windows.
                    .on_new_window(|_, _| NewWindowResponse::Deny)
                    // Keep auth popups decorated and initially bounded.
                    .decorations(true)
                    .inner_size(760.0, 640.0)
                    .title(popup_initial_title(&url))
                    .on_document_title_changed(|window, title| {
                        let _ = window.set_title(&title);
                    });
                    match builder.build() {
                        Ok(window) => {
                            if let Some(observed_epoch) = recovery_epoch {
                                let recovery_app = popup_app.clone();
                                let recovery_provider = popup_provider.clone();
                                window.on_window_event(move |event| {
                                    if !matches!(event, tauri::WindowEvent::Destroyed) {
                                        return;
                                    }
                                    let recovery_app = recovery_app.clone();
                                    let recovery_provider = recovery_provider.clone();
                                    tauri::async_runtime::spawn(async move {
                                        tokio::time::sleep(Duration::from_millis(
                                            GROK_POPUP_RECOVERY_DELAY_MS,
                                        ))
                                        .await;
                                        recover_grok_after_auth_popup(
                                            &recovery_app,
                                            &recovery_provider,
                                            observed_epoch,
                                        );
                                    });
                                });
                            }
                            NewWindowResponse::Create { window }
                        }
                        // Avoid fallback to an unmanaged native popup.
                        Err(_) => NewWindowResponse::Deny,
                    }
                }
                NewWindowAction::DenySilent => NewWindowResponse::Deny,
                NewWindowAction::DenyExternal => {
                    if let Some(host) = url.host_str() {
                        let _ = popup_app.emit_to(
                            "main",
                            "nav://blocked",
                            serde_json::json!({ "provider": &popup_provider, "host": host }),
                        );
                    }
                    if external_handoff_allowed(&popup_provider, &url) {
                        let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
                        schedule_grok_external_auth_return(&popup_app, &popup_provider, &url);
                    }
                    NewWindowResponse::Deny
                }
            }
        });

    let prepared_epoch = prepare_grok_navigation(&provider)?;
    let client_size = window.inner_size().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let (child_position, child_size) = if provider == "claude" {
        claude_login_tabs::content_bounds(&window)?
    } else {
        (PhysicalPosition::new(0, 0), client_size)
    };
    #[cfg(not(target_os = "macos"))]
    let (child_position, child_size) = (PhysicalPosition::new(0, 0), client_size);
    let webview = match window.add_child(
        builder,
        child_position,
        child_size,
    ) {
        Ok(webview) => webview,
        Err(error) => {
            cancel_grok_navigation(&provider, prepared_epoch);
            return Err(error.to_string());
        }
    };
    if let Err(error) = webview.show() {
        cancel_grok_navigation(&provider, prepared_epoch);
        return Err(error.to_string());
    }
    #[cfg(target_os = "macos")]
    if provider == "claude" {
        claude_login_tabs::layout(&app, &window);
    }
    schedule_grok_navigation_start_lease(&provider, prepared_epoch, GrokNavigationOwner::Lifecycle);
    let current = current_state(&provider);
    let state = if current.webview == "loaded" {
        current
    } else {
        let state = state_with(&provider, "loaded", "unknown", "unknown", false);
        set_state(&app, state.clone());
        state
    };
    Ok(state)
}

#[tauri::command]
pub async fn provider_close(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    close_provider(&app, &provider)
}

fn close_provider(app: &AppHandle, provider: &str) -> Result<(), String> {
    let label = provider_label(provider);
    retire_grok_document(provider);
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    if provider == "claude" { claude_login_tabs::close_tabs(app); }
    if let Some(window) = app.get_window(&provider_page_window_label(provider)) {
        let _ = window.hide();
    }
    if let Ok(mut guard) = runtime().lock() {
        guard.engine_boot.remove(provider);
        guard.bridge_boot.remove(provider);
        guard.status_boot.remove(provider);
        guard.grok_app_title_epoch.remove(provider);
        guard.grok_adopted_boot.remove(provider);
        guard.grok_pending_navigation.remove(provider);
        guard.pending_session_boot.remove(provider);
        guard.last_push_ms.remove(provider);
        guard.stale_check_sent.remove(provider);
    }
    set_state(
        app,
        state_with(provider, "none", "unknown", "unknown", false),
    );
    Ok(())
}

pub(crate) fn close_standby_provider(app: &AppHandle, provider: &str) -> Result<(), String> {
    let has_webview = app.get_webview(&provider_label(provider)).is_some();
    if !has_webview && current_state(provider).webview == "none" {
        return Ok(());
    }
    close_provider(app, provider)
}

#[tauri::command]
pub async fn provider_show(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    focus: Option<bool>,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    let label = provider_label(&provider);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    if is_provider_detached(&webview, &provider) {
        return Ok(());
    }
    webview.show().map_err(|error| error.to_string())?;
    if provider_show_should_focus(focus) {
        webview.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn provider_hide(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    let label = provider_label(&provider);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    if is_provider_detached(&webview, &provider) {
        // Background parking must not blank a user-opened standalone page.
        return Ok(());
    }
    webview.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn provider_set_bounds(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    bounds: Bounds,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    let (position, size) = physical_bounds(&bounds)?;
    let label = provider_label(&provider);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    if is_provider_detached(&webview, &provider) {
        // A separate window owns its own bounds and auto-resize.
        return Ok(());
    }
    set_webview_bounds(&webview, position, size)
}

#[tauri::command]
pub async fn provider_control_action(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    action: String,
    text: Option<String>,
    mid: Option<u64>,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    let js = build_provider_control_script(&provider, &action, text.as_deref(), mid)?;
    ensure_provider_control_eval_allowed(&provider, &js, false)?;
    eval_provider(&app, &provider, &js)
}

#[tauri::command]
pub async fn provider_bridge_read(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    kind: String,
) -> Result<String, String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    let js = provider_bridge_read_script(&kind)?;
    ensure_provider_control_eval_allowed(&provider, js, true)?;
    eval_provider_with_callback(&app, &provider, js).await
}

// Native-only helper for the fixed, JSON-serialized broken-adapter report.
// This is NOT a Tauri command and is not reachable through frontend IPC.
pub(crate) async fn eval_provider_with_callback_from_control(
    app: &AppHandle,
    provider: &str,
    js: &str,
) -> Result<String, String> {
    settings::ensure_provider_active(app, provider)?;
    ensure_provider_control_eval_allowed(provider, js, true)?;
    eval_provider_with_callback(app, provider, js).await
}

async fn eval_provider_with_callback(
    app: &AppHandle,
    provider: &str,
    js: &str,
) -> Result<String, String> {
    let webview = get_provider_webview_for_generic_eval(app, provider)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
    let callback_sender = sender.clone();
    webview
        .eval_with_callback(js, move |result| {
            if let Ok(mut sender) = callback_sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(result);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "eval_with_callback timed out".to_string())?
        .map_err(|_| "eval_with_callback response channel closed".to_string())
}


/// Apply the native page window's current client size to its attached
/// provider view. Reparenting preserves the old child size. Use Tauri's
/// independent size/position setters rather than the combined bounds route
/// that has left WKWebView at its old pane dimensions on macOS.
fn fit_detached_provider_to_window(
    provider_view: &tauri::Webview,
    parent_window: &tauri::Window,
) -> Result<(), String> {
    let size = parent_window.inner_size().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let (position, size) = if provider_view.label() == "ai-claude" {
        claude_login_tabs::content_bounds(parent_window)?
    } else {
        (PhysicalPosition::new(0, 0), size)
    };
    #[cfg(not(target_os = "macos"))]
    let position = PhysicalPosition::new(0, 0);
    provider_view
        .set_position(tauri::Position::Physical(position))
        .map_err(|error| error.to_string())?;
    provider_view
        .set_size(tauri::Size::Physical(size))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWindowGeometry {
    window_width: u32,
    window_height: u32,
    webview_width: u32,
    webview_height: u32,
    webview_x: i32,
    webview_y: i32,
}

fn detached_provider_geometry(
    provider_view: &tauri::Webview,
    parent_window: &tauri::Window,
) -> Result<ProviderWindowGeometry, String> {
    let window = parent_window.inner_size().map_err(|error| error.to_string())?;
    let webview = provider_view.size().map_err(|error| error.to_string())?;
    let origin = provider_view.position().map_err(|error| error.to_string())?;
    Ok(ProviderWindowGeometry {
        window_width: window.width,
        window_height: window.height,
        webview_width: webview.width,
        webview_height: webview.height,
        webview_x: origin.x,
        webview_y: origin.y,
    })
}

#[tauri::command]
pub async fn provider_open_window(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    login: Option<bool>,
) -> Result<ProviderWindowGeometry, String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    let provider_webview = get_provider_webview(&app, &provider)?;
    let window_label = provider_page_window_label(&provider);

    // The provider was constructed in this dedicated window at startup.
    // Never move it: reparented WKWebViews on macOS retained their old
    // content-pane frame, despite multiple successful resize calls.
    let window = app
        .get_window(&window_label)
        .ok_or_else(|| format!("provider host window missing: {window_label}"))?;
    if !is_provider_detached(&provider_webview, &provider) {
        return Err(format!("provider WebView has unexpected parent: {provider}"));
    }

    if login.unwrap_or(false) {
        let adapter = adapters::get_adapter(&provider)?;
        let login_url = tauri::Url::parse(&adapter.urls.login)
            .map_err(|error| format!("Invalid provider login URL: {error}"))?;
        provider_webview
            .navigate(login_url)
            .map_err(|error| error.to_string())?;
    }

    // A WebView constructed at its destination can follow native resizing via
    // the builder's auto_resize() policy. Explicitly fit once after showing
    // the host, without any transfer between windows.
    window.show().map_err(|error| error.to_string())?;
    provider_webview.show().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    if provider == "claude" { claude_login_tabs::show_claude(&app)?; }
    fit_detached_provider_to_window(&provider_webview, &window)?;
    window.set_focus().map_err(|error| error.to_string())?;
    let geometry = detached_provider_geometry(&provider_webview, &window)?;
    eprintln!("Workbench provider host {} geometry: {:?}", provider, geometry);
    Ok(geometry)
}

#[tauri::command]
pub async fn provider_open_login(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    bounds: Bounds,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    let adapter = adapters::get_adapter(&provider)?;
    settings::ensure_provider_active(&app, &provider)?;
    let _ = physical_bounds(&bounds)?;
    let provider_webview = get_provider_webview(&app, &provider)
        .map_err(|_| format!("Open {provider} before logging in"))?;
    let login_url = tauri::Url::parse(&adapter.urls.login)
        .map_err(|error| format!("invalid provider login URL: {error}"))?;
    // Legacy callers may still use this command. Never apply main-pane
    // bounds to a WebView created in its native host window.
    if is_provider_detached(&provider_webview, &provider) {
        let window = app.get_window(&provider_page_window_label(&provider))
            .ok_or_else(|| format!("provider host window missing: {provider}"))?;
        provider_webview.navigate(login_url).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        provider_webview.show().map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        if provider == "claude" { claude_login_tabs::show_claude(&app)?; }
        fit_detached_provider_to_window(&provider_webview, &window)?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    Err(format!("provider WebView is not in its native host window: {provider}"))
}

#[tauri::command]
pub async fn provider_open_login_external(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    let adapter = adapters::get_adapter(&provider)?;
    app.opener()
        .open_url(adapter.urls.login.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn reload_provider_document_after_prepare(
    app: &AppHandle,
    provider: &str,
    prepared_epoch: u64,
) -> Result<(), String> {
    reset_bridge_state(app, provider);
    let reload_result = get_provider_webview(app, provider)
        .and_then(|provider_webview| provider_webview.reload().map_err(|error| error.to_string()));
    if let Err(error) = reload_result {
        cancel_grok_navigation(provider, prepared_epoch);
        return Err(error);
    }
    schedule_grok_navigation_start_lease(provider, prepared_epoch, GrokNavigationOwner::Lifecycle);
    Ok(())
}

fn recover_grok_after_auth_popup(app: &AppHandle, provider: &str, observed_epoch: u64) {
    let Some(prepared_epoch) = prepare_grok_popup_recovery(provider, observed_epoch) else {
        return;
    };
    let Ok(provider_webview) = get_provider_webview(app, provider) else {
        cancel_grok_popup_recovery(provider, prepared_epoch);
        return;
    };
    if !claim_grok_popup_recovery(provider, observed_epoch, prepared_epoch)
        || !grok_popup_recovery_claim_is_current(provider, prepared_epoch)
    {
        cancel_grok_popup_recovery(provider, prepared_epoch);
        return;
    }
    if provider_webview.reload().is_err() {
        cancel_grok_popup_recovery(provider, prepared_epoch);
        return;
    }
    schedule_grok_navigation_start_lease(
        provider,
        prepared_epoch,
        GrokNavigationOwner::PopupClaimed,
    );
}

fn recover_grok_after_external_auth_handoff(
    webview: &tauri::Webview,
    provider: &str,
    observed_epoch: u64,
) {
    let Some(prepared_epoch) = prepare_grok_external_auth_return(provider, observed_epoch) else {
        return;
    };
    let app_url = adapters::get_adapter(provider).and_then(|adapter| {
        tauri::Url::parse(&adapter.urls.app)
            .map_err(|error| format!("invalid provider URL: {error}"))
    });
    if !grok_external_auth_return_is_current(provider, observed_epoch, prepared_epoch) {
        cancel_grok_navigation(provider, prepared_epoch);
        return;
    }
    let navigate_result =
        app_url.and_then(|url| webview.navigate(url).map_err(|error| error.to_string()));
    if navigate_result.is_err() {
        cancel_grok_navigation(provider, prepared_epoch);
        return;
    }
    schedule_grok_navigation_start_lease(provider, prepared_epoch, GrokNavigationOwner::Lifecycle);
}

#[tauri::command]
pub async fn provider_reload(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
    reconnect: Option<bool>,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    if reconnect.unwrap_or(false) {
        let state = current_state(&provider);
        if !grok_reconnect_allowed(&state, now_ms()) {
            return Ok(());
        }

        // Recreate only after the host-side stale-state guard passes. This deliberately does not
        // evaluate the current document: it may be a Grok/Cloudflare challenge whose title event
        // was never observed. The new child uses provider_open's same persistent profile.
        let provider_webview = get_provider_webview(&app, &provider)?;
        let position = provider_webview
            .position()
            .map_err(|error| error.to_string())?;
        let size = provider_webview.size().map_err(|error| error.to_string())?;
        let bounds = Bounds {
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(size.width),
            height: f64::from(size.height),
        };

        // Re-check immediately before closing so a late healthy/thinking/blocked status report
        // wins over the click that was rendered from an older snapshot.
        if !grok_reconnect_allowed(&current_state(&provider), now_ms()) {
            return Ok(());
        }
        provider_close(app.clone(), webview.clone(), provider.clone()).await?;
        provider_open(app, webview, provider, bounds).await?;
        return Ok(());
    }
    let prepared_epoch = prepare_grok_navigation(&provider)?;
    reload_provider_document_after_prepare(&app, &provider, prepared_epoch)
}

#[tauri::command]
pub async fn provider_new_session(
    app: AppHandle,
    webview: tauri::Webview,
    provider: String,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    settings::ensure_provider_active(&app, &provider)?;
    if app.get_webview(&provider_label(&provider)).is_none() {
        return Err(format!("provider webview is not open: {provider}"));
    }
    let adapter = adapters::get_adapter(&provider)?;
    let app_url = tauri::Url::parse(&adapter.urls.app)
        .map_err(|error| format!("invalid provider app URL: {error}"))?;
    let prepared_epoch = prepare_grok_navigation(&provider)?;
    if let Err(error) = begin_session_reset(&app, &provider) {
        cancel_grok_navigation(&provider, prepared_epoch);
        return Err(error);
    }
    let navigate_result = get_provider_webview(&app, &provider).and_then(|provider_webview| {
        provider_webview
            .navigate(app_url)
            .map_err(|error| error.to_string())
    });
    if let Err(error) = navigate_result {
        cancel_session_reset(&provider);
        cancel_grok_navigation(&provider, prepared_epoch);
        return Err(error);
    }
    // This command's ready deadline is also its navigation-start lease. Keeping one owner here
    // avoids a shorter background lease releasing the token while this async command still polls.

    let deadline =
        tokio::time::Instant::now() + Duration::from_secs(NEW_SESSION_READY_TIMEOUT_SECS);
    while tokio::time::Instant::now() < deadline {
        if let Some(status_boot) = session_reset_ready_boot(&provider) {
            let expected_boot =
                serde_json::to_string(&status_boot).map_err(|error| error.to_string())?;
            let matches_current_document = eval_provider_with_callback(
                &app,
                &provider,
                &format!(
                    "Boolean(window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.bootId === {expected_boot})"
                ),
            )
            .await
            .ok()
            .is_some_and(|raw| eval_callback_reports_true(&raw));
            if matches_current_document {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(NEW_SESSION_READY_POLL_MS)).await;
    }

    cancel_session_reset(&provider);
    cancel_grok_navigation(&provider, prepared_epoch);
    Err(format!(
        "provider new session did not become ready within {} seconds: {provider}",
        NEW_SESSION_READY_TIMEOUT_SECS
    ))
}

#[tauri::command]
pub async fn connections_get(webview: tauri::Webview) -> Result<Vec<ProviderState>, String> {
    ensure_control_webview(&webview)?;
    let guard = runtime()
        .lock()
        .map_err(|_| "provider state poisoned".to_string())?;
    let mut states = Vec::new();
    for provider in adapters::all_provider_states() {
        states.push(guard.states.get(&provider).cloned().unwrap_or_else(|| {
            let mut state = state_with(&provider, "none", "unknown", "unknown", false);
            if adapters::broken_adapters().contains(&provider) {
                state.adapter = "broken".into();
            }
            state
        }));
    }
    Ok(states)
}

/// Dev-only stdout logger for the M1 live-gate harness.
#[tauri::command]
pub async fn dev_log(
    app: AppHandle,
    webview: tauri::Webview,
    message: String,
) -> Result<(), String> {
    ensure_control_webview(&webview)?;
    if !cfg!(debug_assertions) {
        let _ = app;
        return Ok(());
    }
    if message == "__M1GATE_EXIT__" {
        println!("[M1GATE] exit requested; shutting down");
        app.exit(0);
        return Ok(());
    }
    println!("{message}");
    let _ = io::stdout().flush();
    Ok(())
}

pub(crate) fn bridge_title_is_eligible(provider: &str, msg: &BridgeMessage) -> bool {
    msg.action != "STATUS_REPORT" || grok_bridge_boot_is_current(provider, msg.boot_id.as_deref())
}

pub(crate) fn handle_bridge_title(
    app: &AppHandle,
    provider: &str,
    msg: &BridgeMessage,
) -> Result<bool, String> {
    if msg.action != "STATUS_REPORT" {
        return Ok(true);
    }
    if !accept_status_for_session_reset(provider, msg.boot_id.as_deref()) {
        return Ok(false);
    }
    if should_reset_bridge_on_boot_rotation(provider, msg.boot_id.as_deref()) {
        let mut state = current_state(provider);
        state.bridge = "ok".into();
        state.bridge_reason = None;
        if let Ok(mut guard) = runtime().lock() {
            guard.bridge_boot.remove(provider);
        }
        set_state(app, state);
    }
    let payload = msg.payload.as_ref();
    if let Some(payload) = payload {
        let dom = payload.get("dom").and_then(|v| v.as_str());
        if let Some("unknown") = dom {
            let boot = msg.boot_id.clone().unwrap_or_default();
            let should_push = current_url_matches_provider(app, provider)? && {
                let guard = runtime()
                    .lock()
                    .map_err(|_| "provider state poisoned".to_string())?;
                let already_pushed = guard.engine_boot.get(provider) == Some(&boot);
                (!already_pushed || can_push_now(&guard, provider))
                    && can_push_now(&guard, provider)
            };
            if should_push {
                let _ = push_engine_and_adapter(app, provider);
                if let Ok(mut guard) = runtime().lock() {
                    guard.engine_boot.insert(provider.to_string(), boot);
                    guard.last_push_ms.insert(provider.to_string(), now_ms());
                }
            }
        }
    }
    update_status_state(app, provider, payload, msg.boot_id.as_deref());
    Ok(true)
}

fn should_reset_bridge_on_boot_rotation(provider: &str, incoming_boot: Option<&str>) -> bool {
    let state = current_state(provider);
    let last_boot = runtime()
        .lock()
        .ok()
        .and_then(|guard| guard.bridge_boot.get(provider).cloned());
    bridge_resets_on_boot_rotation(&state.bridge, last_boot.as_deref(), incoming_boot)
}

fn bridge_resets_on_boot_rotation(
    current_bridge: &str,
    last_boot: Option<&str>,
    incoming_boot: Option<&str>,
) -> bool {
    match (last_boot, incoming_boot) {
        (Some(last), Some(incoming)) => current_bridge == "degraded" && last != incoming,
        _ => false,
    }
}

/// Recover a missed document-start bridge after a ChatGPT page restart.
 /// Only the recognized provider application document is eligible; eval_provider
 /// rejects SSO and renderer URLs. Bootstrap independently refuses challenges
 /// and non-top-frame documents. This never navigates or signs users out.
fn recover_regular_provider_bridge(app: &AppHandle, provider: &str) -> Result<(), String> {
    if provider != "chatgpt" {
        return Ok(());
    }
    let state = current_state(provider);
    if state.webview != "loaded" || state.login == "blocked" || state.thinking {
        return Ok(());
    }
    let app_hosts = serde_json::to_string(&adapters::app_hosts_for_provider(provider)?)
        .map_err(|error| error.to_string())?;
    let provider_json = serde_json::to_string(provider).map_err(|error| error.to_string())?;
    let js = format!(
        "window.__MAC_PROVIDER__={provider_json};\nwindow.__MAC_APP_HOSTS__={app_hosts};\n{BOOTSTRAP_JS}"
    );
    eval_provider(app, provider, &js)?;
    push_engine_and_adapter(app, provider)
}

pub(crate) fn push_engine_and_adapter(app: &AppHandle, provider: &str) -> Result<(), String> {
    let adapter = adapters::get_adapter(provider)?;
    let dispatch_adapter = serde_json::json!({
        "v": 1,
        "action": "ADAPTER_UPDATE",
        "provider": provider,
        "payload": adapter
    });
    let dispatch_check = serde_json::json!({
        "v": 1,
        "action": "CHECK_STATUS",
        "provider": provider
    });
    let js = format!(
        "{engine}\nwindow.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch({adapter_msg});\nwindow.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch({check_msg});",
        engine = ENGINE_JS,
        adapter_msg = serde_json::to_string(&dispatch_adapter).map_err(|error| error.to_string())?,
        check_msg = serde_json::to_string(&dispatch_check).map_err(|error| error.to_string())?,
    );
    if provider == "claude" {
        let webview = get_provider_webview(app, provider)?;
        if !webview.url().ok().is_some_and(|url| claude_conversation_url(&url)) {
            return Err("Claude bridge must not run on login or account pages".into());
        }
        return eval_provider(app, provider, &guard_claude_automation(&js));
    }
    eval_provider(app, provider, &js)
}

fn delayed_grok_bridge_script(provider: &str) -> Result<String, String> {
    let adapter = adapters::get_adapter(provider)?;
    let challenge_signals = serde_json::from_str::<serde_json::Value>(CHALLENGE_SIGNALS_JSON)
        .map_err(|error| format!("invalid shared challenge signals: {error}"))?;
    let challenge_signals_json =
        serde_json::to_string(&challenge_signals).map_err(|error| error.to_string())?;
    let provider_json = serde_json::to_string(provider).map_err(|error| error.to_string())?;
    let app_hosts_json = serde_json::to_string(&adapters::app_hosts_for_provider(provider)?)
        .map_err(|error| error.to_string())?;
    let dispatch_adapter = serde_json::json!({
        "v": 1,
        "action": "ADAPTER_UPDATE",
        "provider": provider,
        "payload": adapter
    });
    let dispatch_check = serde_json::json!({
        "v": 1,
        "action": "CHECK_STATUS",
        "provider": provider
    });
    let template = r#"(function driveGrokBridge() {
  try {
    if (
      window.self !== window.top ||
      location.protocol !== 'https:' ||
      location.hostname !== 'grok.com'
    ) {
      return { outcome: 'ineligible' };
    }

    var challengeSignals = __MAC_CHALLENGE_SIGNALS_JSON__;
    function normalize(value) {
      return String(value || '').trim().toLocaleLowerCase();
    }
    function includesSignal(value, signals) {
      var normalized = normalize(value);
      return signals.some(function (signal) { return normalized.indexOf(signal) !== -1; });
    }
    function sampleBodyText() {
      if (!document.body) return '';
      try {
        var walker = document.createTreeWalker(document.body, 4);
        var sample = '';
        var node = walker.nextNode();
        while (node && sample.length < challengeSignals.bodySampleChars) {
          if (node.nodeValue) {
            sample += ' ' + node.nodeValue.slice(0, challengeSignals.bodySampleChars - sample.length);
          }
          node = walker.nextNode();
        }
        return sample.slice(0, challengeSignals.bodySampleChars);
      } catch (_) {
        return String(document.body.innerText || document.body.textContent || '')
          .slice(0, challengeSignals.bodySampleChars);
      }
    }
    function challengeActive() {
      if (document.querySelector(challengeSignals.markerSelector)) return true;
      if (includesSignal(document.title, challengeSignals.titleSignals)) return true;
      return includesSignal(sampleBodyText(), challengeSignals.bodySignals);
    }
    function installEngineAndAdapter() {
      __MAC_ENGINE_JS__
      window.__MAC_BRIDGE__.dispatch(__MAC_ADAPTER_MESSAGE__);
      window.__MAC_BRIDGE__.dispatch(__MAC_CHECK_MESSAGE__);
    }

    // This read-only decision and the bridge installation run in one JavaScript task. No provider
    // global or DOM state is changed unless the challenge result is explicitly negative.
    if (challengeActive()) return { outcome: 'challenge' };
    if (window.__MAC_BRIDGE__) {
      installEngineAndAdapter();
      return { outcome: 'present', bootId: String(window.__MAC_BRIDGE__.bootId || '') };
    }
    if (document.readyState === 'loading') return { outcome: 'waiting' };

    var title = normalize(document.title);
    if (!(title === 'grok' || title.indexOf('grok - ') === 0 || title.indexOf('grok — ') === 0)) {
      return { outcome: 'ineligible' };
    }

    window.__MAC_PROVIDER__ = __MAC_PROVIDER_JSON__;
    window.__MAC_APP_HOSTS__ = __MAC_APP_HOSTS_JSON__;
    __MAC_BOOTSTRAP_JS__
    if (!window.__MAC_BRIDGE__) {
      return { outcome: challengeActive() ? 'challenge' : 'waiting' };
    }
    installEngineAndAdapter();
    return { outcome: 'installed', bootId: String(window.__MAC_BRIDGE__.bootId || '') };
  } catch (error) {
    try { console.error('[MAC Grok bridge driver]', error); } catch (_) {}
    return { outcome: 'retry' };
  }
})()"#;
    Ok(template
        .replace("__MAC_CHALLENGE_SIGNALS_JSON__", &challenge_signals_json)
        .replace("__MAC_ENGINE_JS__", ENGINE_JS)
        .replace(
            "__MAC_ADAPTER_MESSAGE__",
            &serde_json::to_string(&dispatch_adapter).map_err(|error| error.to_string())?,
        )
        .replace(
            "__MAC_CHECK_MESSAGE__",
            &serde_json::to_string(&dispatch_check).map_err(|error| error.to_string())?,
        )
        .replace("__MAC_PROVIDER_JSON__", &provider_json)
        .replace("__MAC_APP_HOSTS_JSON__", &app_hosts_json)
        .replace("__MAC_BOOTSTRAP_JS__", BOOTSTRAP_JS))
}

fn cached_grok_bridge_script() -> Result<&'static str, String> {
    static SCRIPT: OnceLock<Result<String, String>> = OnceLock::new();
    match SCRIPT.get_or_init(|| delayed_grok_bridge_script("grok")) {
        Ok(script) => Ok(script.as_str()),
        Err(error) => Err(error.clone()),
    }
}

fn update_status_state(
    app: &AppHandle,
    provider: &str,
    payload: Option<&serde_json::Value>,
    boot_id: Option<&str>,
) {
    let mut state = current_state(provider);
    state.webview = "loaded".into();
    state.last_status_at = now_ms();
    let mut bridge_update = None;
    if let Some(payload) = payload {
        if let Some(dom) = payload.get("dom").and_then(|v| v.as_str()) {
            if dom == "ready" || dom == "unknown" {
                state.dom = dom.into();
            }
        }
        if let Some(login) = payload.get("login").and_then(|v| v.as_str()) {
            state.login = login.into();
        } else if let Some(logged_in) = payload.get("loggedIn").and_then(|v| v.as_bool()) {
            state.login = if logged_in { "logged_in" } else { "logged_out" }.into();
        }
        if let Some(thinking) = payload.get("thinking").and_then(|v| v.as_bool()) {
            state.thinking = thinking;
        }
        if let Some(bridge) = payload.get("bridge").and_then(|v| v.as_str()) {
            if bridge == "degraded" || bridge == "ok" {
                state.bridge = bridge.into();
                bridge_update = Some(bridge);
            }
        }
        if let Some(reason) = payload.get("reason").and_then(|v| v.as_str()) {
            state.bridge_reason = Some(reason.into());
        } else if state.bridge == "ok" {
            state.bridge_reason = None;
        }
    }
    if let Ok(mut guard) = runtime().lock() {
        match bridge_update {
            Some("degraded") => {
                if let Some(boot_id) = boot_id {
                    guard
                        .bridge_boot
                        .insert(provider.to_string(), boot_id.to_string());
                }
            }
            Some("ok") => {
                guard.bridge_boot.remove(provider);
            }
            _ => {}
        }
        guard.stale_check_sent.remove(provider);
    }
    set_state(app, state);
}

fn can_push_now(guard: &ProviderRuntime, provider: &str) -> bool {
    now_ms().saturating_sub(*guard.last_push_ms.get(provider).unwrap_or(&0)) >= 1000
}

fn get_provider_webview(app: &AppHandle, provider: &str) -> Result<tauri::Webview, String> {
    let label = provider_label(provider);
    app.get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))
}

fn get_provider_webview_for_generic_eval(
    app: &AppHandle,
    provider: &str,
) -> Result<tauri::Webview, String> {
    let webview = get_provider_webview(app, provider)?;
    let url = webview.url().map_err(|error| error.to_string())?;
    // Even if the site uses a same-document SPA route transition, disallow any
    // trusted host command (read, fill, send, poll) on Claude login/account pages.
    if provider == "claude" && !claude_conversation_url(&url) {
        return Err("Claude automation is disabled outside its conversation pages".into());
    }
    let url_matches_app = adapters::url_matches_provider_app(provider, &url)?;
    let allowed = if provider == "grok" {
        let guard = runtime()
            .lock()
            .map_err(|_| "provider state poisoned".to_string())?;
        let current_epoch = guard
            .grok_document_epoch
            .get(provider)
            .copied()
            .unwrap_or_default();
        provider_document_allows_generic_eval(
            provider,
            url_matches_app,
            guard.states.get(provider),
            current_epoch,
            guard.grok_app_title_epoch.get(provider).copied(),
            guard
                .grok_adopted_boot
                .get(provider)
                .map(|(epoch, _)| *epoch),
            guard.grok_pending_navigation.contains_key(provider),
        )
    } else {
        provider_document_allows_generic_eval(provider, url_matches_app, None, 0, None, None, false)
    };
    if !allowed {
        return Err(format!(
            "script evaluation is not allowed for the current {provider} document"
        ));
    }
    Ok(webview)
}

// A 40-second missed-status watchdog marks the provider DOM "unknown".
 // The response transport must still be allowed to *read its own outbox*
 // from the already-loaded ChatGPT app, or it becomes impossible for the
 // bridge to recover from that stale state. This exception is deliberately
 // restricted to the two exact internal bridge expressions. Normal provider
 // control actions (send, fill, stop, arbitrary evaluation) still require
 // a current "ready" DOM. get_provider_webview_for_generic_eval separately
 // enforces the recognized ChatGPT app URL for either expression.
fn stale_chatgpt_bridge_eval_allowed(
    provider: &str,
    state: &ProviderState,
    js: &str,
    callback: bool,
) -> bool {
    if provider != "chatgpt"
        || state.webview != "loaded"
        || state.dom != "unknown"
        || state.login != "logged_in"
    {
        return false;
    }
    if callback {
        return js == CHATGPT_BRIDGE_PEEK_JS || js == CHATGPT_BRIDGE_HEALTH_JS;
    }
    let Some(mid) = js
        .strip_prefix(CHATGPT_BRIDGE_ACK_PREFIX)
        .and_then(|remaining| remaining.strip_suffix(");"))
    else {
        return false;
    };
    // Acknowledgement values are generated from monotonic outbox IDs by
    // the trusted control pane. Reject injected JS and non-safe integers.
    mid.parse::<u64>()
        .is_ok_and(|mid| mid > 0 && mid <= 9_007_199_254_740_991)
}

fn ensure_provider_control_eval_allowed(
    provider: &str,
    js: &str,
    callback: bool,
) -> Result<(), String> {
    let state = current_state(provider);
    if provider_state_allows_control_eval(&state)
        || stale_chatgpt_bridge_eval_allowed(provider, &state, js, callback)
    {
        Ok(())
    } else {
        Err(format!(
            "script evaluation is not ready for provider: {provider}"
        ))
    }
}

fn eval_provider(app: &AppHandle, provider: &str, js: &str) -> Result<(), String> {
    let webview = get_provider_webview_for_generic_eval(app, provider)?;
    webview.eval(js).map_err(|error| error.to_string())
}

pub(crate) fn ensure_control_webview(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("command is only available to the main control webview".into())
    }
}

fn provider_label(provider: &str) -> String {
    format!("ai-{provider}")
}

fn provider_page_window_label(provider: &str) -> String {
    format!("provider-page-{provider}")
}

fn is_provider_detached(webview: &tauri::Webview, provider: &str) -> bool {
    webview.window().label() == provider_page_window_label(provider)
}


fn set_webview_bounds<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    // 前端傳來的是實體像素（CSS px × devicePixelRatio），必須用 Physical。
    // 用 Logical 會少乘 WebView2 的頁面縮放（Windows「文字大小」），造成 webview 錯位。
    webview
        .set_bounds(tauri::Rect {
            position: tauri::Position::Physical(position),
            size: tauri::Size::Physical(size),
        })
        .map_err(|error| error.to_string())
}

fn current_state(provider: &str) -> ProviderState {
    runtime()
        .lock()
        .ok()
        .and_then(|guard| guard.states.get(provider).cloned())
        .unwrap_or_else(|| state_with(provider, "none", "unknown", "unknown", false))
}

fn set_state(app: &AppHandle, state: ProviderState) {
    if let Ok(mut guard) = runtime().lock() {
        guard.states.insert(state.provider.clone(), state.clone());
    }
    let _ = app.emit_to("main", "connections://update", &state);
}

fn state_with(
    provider: &str,
    webview: &str,
    dom: &str,
    login: &str,
    thinking: bool,
) -> ProviderState {
    ProviderState {
        provider: provider.into(),
        webview: webview.into(),
        dom: dom.into(),
        login: login.into(),
        thinking,
        last_status_at: now_ms(),
        bridge: "ok".into(),
        bridge_reason: None,
        adapter: if adapters::broken_adapters().contains(provider) {
            "broken"
        } else {
            "ok"
        }
        .into(),
    }
}

fn current_url_matches_provider(app: &AppHandle, provider: &str) -> Result<bool, String> {
    let label = provider_label(provider);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    let url = webview.url().map_err(|error| error.to_string())?;
    adapters::url_matches_provider_app(provider, &url)
}

fn reset_state_for_page_load(state: &mut ProviderState) {
    state.dom = "unknown".into();
    state.thinking = false;
    state.last_status_at = now_ms();
    state.bridge = "ok".into();
    state.bridge_reason = None;
}

fn reset_bridge_state(app: &AppHandle, provider: &str) {
    if let Ok(mut guard) = runtime().lock() {
        guard.engine_boot.remove(provider);
        guard.bridge_boot.remove(provider);
        guard.last_push_ms.remove(provider);
        guard.stale_check_sent.remove(provider);
    }
    let mut state = current_state(provider);
    reset_state_for_page_load(&mut state);
    set_state(app, state);
}

fn begin_session_reset(app: &AppHandle, provider: &str) -> Result<(), String> {
    {
        let mut guard = runtime()
            .lock()
            .map_err(|_| "provider state poisoned".to_string())?;
        let previous_boot = guard.status_boot.get(provider).cloned();
        guard
            .pending_session_boot
            .insert(provider.to_string(), previous_boot);
    }
    reset_bridge_state(app, provider);
    Ok(())
}

fn cancel_session_reset(provider: &str) {
    if let Ok(mut guard) = runtime().lock() {
        guard.pending_session_boot.remove(provider);
    }
}

fn accept_status_for_session_reset(provider: &str, incoming_boot: Option<&str>) -> bool {
    let Ok(mut guard) = runtime().lock() else {
        return false;
    };
    if provider == "grok" {
        let Some(incoming_boot) = incoming_boot else {
            return false;
        };
        let current_epoch = guard
            .grok_document_epoch
            .get(provider)
            .copied()
            .unwrap_or_default();
        if !guard
            .grok_adopted_boot
            .get(provider)
            .is_some_and(|(epoch, adopted_boot)| {
                *epoch == current_epoch && adopted_boot == incoming_boot
            })
        {
            return false;
        }
    }
    if let Some(previous_boot) = guard.pending_session_boot.get(provider).cloned() {
        if !fresh_session_boot(previous_boot.as_deref(), incoming_boot) {
            return false;
        }
        guard.pending_session_boot.remove(provider);
    }
    if let Some(incoming_boot) = incoming_boot {
        guard
            .status_boot
            .insert(provider.to_string(), incoming_boot.to_string());
    }
    true
}

fn fresh_session_boot(previous_boot: Option<&str>, incoming_boot: Option<&str>) -> bool {
    incoming_boot.is_some_and(|incoming| previous_boot != Some(incoming))
}

fn eval_callback_reports_true(raw: &str) -> bool {
    eval_callback_boolean(raw) == Some(true)
}

fn eval_callback_boolean(raw: &str) -> Option<bool> {
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(serde_json::Value::Bool(value)) => Some(value),
        Ok(serde_json::Value::String(value)) => serde_json::from_str::<bool>(&value).ok(),
        _ => None,
    }
}

fn session_reset_ready_boot(provider: &str) -> Option<String> {
    runtime().lock().ok().and_then(|guard| {
        if guard.pending_session_boot.contains_key(provider)
            || !guard
                .states
                .get(provider)
                .is_some_and(|state| state.webview == "loaded" && state.dom == "ready")
        {
            return None;
        }
        guard.status_boot.get(provider).cloned()
    })
}

fn start_staleness_watchdog(app: &AppHandle) {
    let should_start = {
        let Ok(mut guard) = runtime().lock() else {
            return;
        };
        if guard.watchdog_started {
            false
        } else {
            guard.watchdog_started = true;
            true
        }
    };
    if !should_start {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            run_staleness_check(&app);
        }
    });
}

fn run_staleness_check(app: &AppHandle) {
    let now = now_ms();
    let mut to_check = Vec::new();
    let mut to_mark_unknown = Vec::new();
    let mut grok_to_drive = Vec::new();
    let mut claude_to_recover = false;
    let mut state_updates = Vec::new();
    if let Ok(mut guard) = runtime().lock() {
        let providers = guard.states.values().cloned().collect::<Vec<_>>();
        for state in providers {
            if claude_background_recovery_needed(&state, now) {
                claude_to_recover = true;
            }
            let document_epoch = guard
                .grok_document_epoch
                .get(&state.provider)
                .copied()
                .unwrap_or_default();
            let app_title_signal_is_current =
                guard.grok_app_title_epoch.get(&state.provider).copied() == Some(document_epoch);
            if should_drive_grok_bridge_from_background(&state, app_title_signal_is_current) {
                grok_to_drive.push((state.provider.clone(), document_epoch));
            }
            if let Some(reason) = grok_stale_reason(&state, now, app_title_signal_is_current) {
                let mut next_state = state.clone();
                next_state.bridge_reason = Some(reason.into());
                guard
                    .states
                    .insert(state.provider.clone(), next_state.clone());
                state_updates.push(next_state);
            }
            if !generic_staleness_dispatch_allowed(&state, app_title_signal_is_current) {
                guard.stale_check_sent.remove(&state.provider);
                continue;
            }
            match staleness_action(state.last_status_at, now, state.webview == "loaded") {
                StalenessAction::None => {}
                StalenessAction::DispatchCheck
                    if !guard.stale_check_sent.contains_key(&state.provider) =>
                {
                    guard.stale_check_sent.insert(state.provider.clone(), now);
                    to_check.push(state.provider.clone());
                }
                StalenessAction::DispatchCheck => {}
                StalenessAction::MarkUnknown => {
                    to_mark_unknown.push(state.provider.clone());
                    guard.stale_check_sent.remove(&state.provider);
                }
            }
        }
    }
    for state in state_updates {
        let _ = app.emit_to("main", "connections://update", &state);
    }
    if let Ok(script) = cached_grok_bridge_script() {
        for (provider, document_epoch) in grok_to_drive {
            if let Some(webview) = app.get_webview(&provider_label(&provider)) {
                drive_grok_bridge_on_webview(&webview, app, &provider, script, document_epoch);
            }
        }
    }
    // The deferred Claude bridge is deliberately absent on auth documents. If
    // the initial load/title signal was missed while the window was hidden,
    // retry the composer-scoped installer. The installer is single-flight and
    // checks both the native conversation URL and the live composer before
    // injecting anything. Never navigate or show the provider window here.
    if claude_to_recover {
        if let Some(webview) = app.get_webview(&provider_label("claude")) {
            if webview.url().ok().is_some_and(|url| claude_conversation_url(&url)) {
                schedule_claude_bridge_install(app, &webview);
            }
        }
    }
    for provider in to_check {
        // A missing document-start bridge cannot receive CHECK_STATUS. Restore
        // it only for ChatGPT's verified app host, then request a fresh status.
        if provider == "chatgpt" {
            let _ = recover_regular_provider_bridge(app, &provider);
        }
        let msg = serde_json::json!({ "v": 1, "action": "CHECK_STATUS", "provider": provider });
        let js = format!(
            "window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch({});",
            serde_json::to_string(&msg).unwrap_or_default()
        );
        let _ = eval_provider(app, &provider, &js);
    }
    for provider in to_mark_unknown {
        let mut state = current_state(&provider);
        state.dom = "unknown".into();
        set_state(app, state);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StalenessAction {
    None,
    DispatchCheck,
    MarkUnknown,
}

fn staleness_action(last_status_ms: u64, now_ms: u64, webview_loaded: bool) -> StalenessAction {
    if !webview_loaded {
        return StalenessAction::None;
    }
    let age = now_ms.saturating_sub(last_status_ms);
    if age > STATUS_EXPIRED_MS {
        StalenessAction::MarkUnknown
    } else if age >= STATUS_STALE_CHECK_MS {
        StalenessAction::DispatchCheck
    } else {
        StalenessAction::None
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod claude_clean_login_tests {
    use super::{challenge_auxiliary_navigation_allowed, claude_conversation_url, guard_claude_automation, provider_uses_document_start_bridge, provider_uses_permission_shim};

    #[test]
    fn claude_never_modifies_browser_during_login() {
        assert!(!provider_uses_document_start_bridge("claude"));
        assert!(!provider_uses_permission_shim("claude"));
        assert!(provider_uses_document_start_bridge("chatgpt"));
        assert!(provider_uses_permission_shim("gemini"));
    }

    #[test]
    fn claude_auth_allows_only_observed_captcha_navigation_targets() {
        let allow = |provider: &str, value: &str| {
            challenge_auxiliary_navigation_allowed(provider, &value.parse().unwrap())
        };
        // These were the only blocked destinations in the user-controlled
        // successful audit window. Neither is permitted for other providers.
        assert!(allow("claude", "about:blank"));
        assert!(allow("claude", "about:srcdoc"));
        assert!(allow("claude", "https://newassets.hcaptcha.com/captcha/v1/test/hcaptcha.html"));
        assert!(!allow("chatgpt", "about:blank"));
        assert!(!allow("gemini", "https://newassets.hcaptcha.com/captcha/v1/test/hcaptcha.html"));
        for target in [
            "about:config",
            "about:blank?token=should-not-be-here",
            "data:text/html,hello",
            "javascript:alert(1)",
            "http://newassets.hcaptcha.com/captcha",
            "https://newassets.hcaptcha.com:8443/captcha",
            "https://newassets.hcaptcha.com.evil.example/captcha",
            "https://evil.example/newassets.hcaptcha.com",
            "https://newassets-hcaptcha.com/captcha",
            "https://hcaptcha.com/captcha",
            "https://newassets.hcaptcha.com@evil.example/captcha",
        ] {
            assert!(!allow("claude", target), "unexpected allow: {target}");
        }
        // Existing Grok challenge behavior remains unchanged.
        assert!(allow("grok", "about:blank"));
        assert!(!allow("grok", "https://newassets.hcaptcha.com/captcha"));
    }

    #[test]
    fn claude_injection_is_conversation_scoped() {
        for uri in [
            "https://claude.ai/login",
            "https://claude.ai/signup",
            "https://claude.ai/auth/callback?code=private",
            "https://claude.ai/settings",
            "https://claude.ai/chat/123/other",
            "https://claude.ai/chat/",
            "https://claude.ai/account",
            "https://claude.ai/",
            "https://auth.anthropic.com/login",
            "https://claude.ai.evil.example/new",
            "http://claude.ai/new",
            "https://claude.ai:8443/new",
        ] {
            assert!(!claude_conversation_url(&uri.parse().unwrap()), "{uri}");
        }
        assert!(claude_conversation_url(&"https://claude.ai/new".parse().unwrap()));
        assert!(claude_conversation_url(&"https://claude.ai/chat/1234".parse().unwrap()));
        let script = guard_claude_automation("window.__SAFE_TEST__ = 1;");
        assert!(!script.contains("CLAUDE_COMPOSER_READY_JS"));
        assert!(script.contains("location.pathname"));
        assert!(script.contains("window.__SAFE_TEST__ = 1;"));
    }
}

#[cfg(test)]
#[path = "webviews/tests.rs"]
mod tests;
