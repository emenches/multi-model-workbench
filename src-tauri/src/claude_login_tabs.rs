//! Claude login tab strip (macOS).
//!
//! The toolbar is a local WebView with ONLY three dedicated native commands.
//! The email view has no Tauri IPC permissions, initialization scripts, or
//! DOM inspection. Navigation to Claude is handed to the original provider
//! view without reading or logging URLs (magic links may contain secrets).
//! Mac WKWebViews created without data_store_identifier share the app's
//! default persistent website store. Both the original Claude child view and
//! this email view intentionally use that store: NO cookie copying.

use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
};

pub(crate) const TOOLBAR_LABEL: &str = "claude-login-toolbar";
const MAIL_LABEL: &str = "claude-login-mail";
const CLAUDE_LABEL: &str = "ai-claude";
const WINDOW_LABEL: &str = "provider-page-claude";
const TOOLBAR_LOGICAL_HEIGHT: f64 = 76.0;
const DEFAULT_WEBMAIL: &str = "https://mail.google.com/";
const MAIL_POPUP_PREFIX: &str = "claude-email-popup-";
const MAX_EMAIL_POPUPS: usize = 6;
static MAIL_POPUP_SEQUENCE: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

fn safe_browser_navigation(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        || (url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc"))
}

// Diagnostics deliberately never contain a URL path, query, fragment, or a
// magic-link token. They can be shared when a clicked email link does nothing.
fn note_browser_event(event: &str, url: &tauri::Url) {
    eprintln!(
        "[Claude email browser] {event} scheme={} host={}",
        url.scheme(),
        url.host_str().unwrap_or("(no-host)")
    );
}

fn toolbar_height(window: &tauri::Window, total_height: u32) -> u32 {
    let scale = window.scale_factor().unwrap_or(1.0);
    ((TOOLBAR_LOGICAL_HEIGHT * scale).round() as u32).min(total_height.saturating_sub(1))
}

pub(crate) fn content_bounds(
    window: &tauri::Window,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>), String> {
    let total = window.inner_size().map_err(|error| error.to_string())?;
    let offset = toolbar_height(window, total.height);
    Ok((
        PhysicalPosition::new(0, offset as i32),
        PhysicalSize::new(total.width.max(1), total.height.saturating_sub(offset).max(1)),
    ))
}

pub(crate) fn layout(app: &AppHandle, window: &tauri::Window) {
    let Ok(size) = window.inner_size() else { return; };
    let height = toolbar_height(window, size.height);
    if let Some(toolbar) = app.get_webview(TOOLBAR_LABEL) {
        let _ = toolbar.set_position(tauri::Position::Physical(PhysicalPosition::new(0, 0)));
        let _ = toolbar.set_size(tauri::Size::Physical(PhysicalSize::new(size.width.max(1), height.max(1))));
    }
    let Ok((position, content_size)) = content_bounds(window) else { return; };
    for label in [CLAUDE_LABEL, MAIL_LABEL] {
        if let Some(view) = app.get_webview(label) {
            let _ = view.set_position(tauri::Position::Physical(position));
            let _ = view.set_size(tauri::Size::Physical(content_size));
        }
    }
}

pub(crate) fn ensure_toolbar(app: &AppHandle, window: &tauri::Window) -> Result<(), String> {
    if app.get_webview(TOOLBAR_LABEL).is_some() { return Ok(()); }
    let total = window.inner_size().map_err(|e| e.to_string())?;
    let height = toolbar_height(window, total.height);
    let toolbar = window.add_child(
        WebviewBuilder::new(TOOLBAR_LABEL, WebviewUrl::App("claude-login-tabs.html".into())),
        PhysicalPosition::new(0, 0),
        PhysicalSize::new(total.width.max(1), height.max(1)),
    ).map_err(|e| e.to_string())?;
    toolbar.show().map_err(|e| e.to_string())
}

fn trusted_toolbar(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() == TOOLBAR_LABEL { Ok(()) }
    else { Err("Claude login tab controls are toolbar-only".into()) }
}

fn safe_webmail_url(value: &str) -> Result<tauri::Url, String> {
    let mut target = value.trim().to_owned();
    if target.is_empty() {
        target = DEFAULT_WEBMAIL.to_string();
    }
    if !target.contains("://") {
        target = format!("https://{target}");
    }
    let url = tauri::Url::parse(&target).map_err(|_| "Enter a valid HTTPS webmail address")?;
    // No local, file, script, credentials, or insecure navigation from the toolbar.
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only standard HTTPS webmail addresses are allowed".into());
    }
    Ok(url)
}

fn is_claude_link(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("claude.ai")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

/// Gmail's account switch opens a new window to a mailbox-specific URL.
/// Keep that navigation within the original Email tab (same WKWebView and
/// auth data store) instead of leaving it in a detached popup window.
///
/// Match only Gmail's mailbox routes, not accounts.google.com or the OAuth
/// callback pages: those legitimately need their opener-linked popups.
fn is_gmail_mail_route(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("mail.google.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && (url.path() == "/mail" || url.path().starts_with("/mail/"))
}

fn notify_active(app: &AppHandle, tab: &str) {
    let _ = app.emit_to(TOOLBAR_LABEL, "claude-auth-tab:selected", tab);
}

pub(crate) fn show_claude(app: &AppHandle) -> Result<(), String> {
    let claude = app.get_webview(CLAUDE_LABEL)
        .ok_or_else(|| "Claude WebView is not ready".to_string())?;
    claude.show().map_err(|e| e.to_string())?;
    if let Some(mail) = app.get_webview(MAIL_LABEL) {
        mail.hide().map_err(|e| e.to_string())?;
    }
    notify_active(app, "claude");
    Ok(())
}

fn send_magic_link_to_claude(app: AppHandle, url: tauri::Url, popup_label: Option<String>) {
    if !is_claude_link(&url) { return; }
    // Do not log, serialize, emit or store the URL: it may contain a login
    // token. Schedule outside WKNavigationDelegate so we do not navigate
    // reentrantly during the native policy-decision callback.
    eprintln!("[Claude email browser] Claude link detected; handing to original session");
    tauri::async_runtime::spawn(async move {
        let navigate_app = app.clone();
        let result = app.run_on_main_thread(move || {
            if let Some(claude) = navigate_app.get_webview(CLAUDE_LABEL) {
                if claude.navigate(url).is_ok() {
                    let _ = show_claude(&navigate_app);
                    let _ = navigate_app.emit_to(
                        TOOLBAR_LABEL,
                        "claude-auth-tab:handoff",
                        "Login link opened in Claude",
                    );
                    if let Some(label) = popup_label {
                        if let Some(popup) = navigate_app.get_webview_window(&label) {
                            let _ = popup.close();
                        }
                    }
                    eprintln!("[Claude email browser] Handoff requested");
                } else {
                    let _ = navigate_app.emit_to(
                        TOOLBAR_LABEL, "claude-auth-tab:handoff",
                        "Link could not open in Claude",
                    );
                    eprintln!("[Claude email browser] Handoff navigation could not start");
                }
            } else {
                let _ = navigate_app.emit_to(
                    TOOLBAR_LABEL, "claude-auth-tab:handoff",
                    "Claude tab is unavailable",
                );
                eprintln!("[Claude email browser] Original Claude tab is unavailable");
            }
        });
        if result.is_err() {
            eprintln!("[Claude email browser] Handoff could not be queued");
        }
    });
}

fn send_gmail_account_to_email(app: AppHandle, url: tauri::Url, popup_label: Option<String>) {
    if !is_gmail_mail_route(&url) { return; }
    // No Gmail content, account identifiers, mailbox routes, URL queries,
    // or credential material are logged or sent to the app UI.
    eprintln!("[Claude email browser] Gmail account switch detected");
    tauri::async_runtime::spawn(async move {
        let navigate_app = app.clone();
        let result = app.run_on_main_thread(move || {
            if let Some(mail) = navigate_app.get_webview(MAIL_LABEL) {
                if mail.navigate(url).is_ok() {
                    let _ = show_email(&navigate_app);
                    if let Some(label) = popup_label {
                        if let Some(popup) = navigate_app.get_webview_window(&label) {
                            let _ = popup.close();
                        }
                    }
                    let _ = navigate_app.emit_to(
                        TOOLBAR_LABEL, "claude-auth-tab:handoff",
                        "Gmail account opened in Email tab",
                    );
                    eprintln!("[Claude email browser] Gmail account switch handed to Email tab");
                } else {
                    eprintln!("[Claude email browser] Gmail tab navigation failed");
                }
            } else {
                eprintln!("[Claude email browser] Email tab is unavailable");
            }
        });
        if result.is_err() {
            eprintln!("[Claude email browser] Gmail switch could not be queued");
        }
    });
}

/// A webmail message often opens an initially empty popup, then changes its
/// location to a tracking URL and finally to the Claude magic link. Denying
/// the initial about:blank popup prevents ALL later redirects and makes the
/// click appear dead. Preserve WebKit's opener relationship instead.
fn create_email_popup(
    app: &AppHandle,
    target: tauri::Url,
    features: tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    if is_claude_link(&target) {
        send_magic_link_to_claude(app.clone(), target, None);
        return NewWindowResponse::Deny;
    }
    if is_gmail_mail_route(&target) {
        send_gmail_account_to_email(app.clone(), target, None);
        return NewWindowResponse::Deny;
    }
    if !safe_browser_navigation(&target) {
        note_browser_event("popup refused", &target);
        return NewWindowResponse::Deny;
    }
    // Prevent email pages from opening an unbounded number of browser windows.
    let open_popups = app.webview_windows().keys()
        .filter(|label| label.starts_with(MAIL_POPUP_PREFIX))
        .count();
    if open_popups >= MAX_EMAIL_POPUPS {
        eprintln!("[Claude email browser] Popup limit reached");
        return NewWindowResponse::Deny;
    }
    // Every popup is its own WebView with ZERO Tauri IPC permissions and no
    // Workbench JavaScript injection. Only navigation metadata is observed.
    let index = MAIL_POPUP_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("{MAIL_POPUP_PREFIX}{index}");
    let nav_app = app.clone();
    let nested_app = app.clone();
    let label_for_nav = label.clone();
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::External("about:blank".parse().expect("static URL")),
    )
    .window_features(features)
    .decorations(true)
    .inner_size(850.0, 700.0)
    .title("Email link")
    .on_navigation(move |destination| {
        if is_claude_link(destination) {
            send_magic_link_to_claude(
                nav_app.clone(),
                destination.clone(),
                Some(label_for_nav.clone()),
            );
            return false;
        }
        if is_gmail_mail_route(destination) {
            send_gmail_account_to_email(
                nav_app.clone(),
                destination.clone(),
                Some(label_for_nav.clone()),
            );
            return false;
        }
        let allowed = safe_browser_navigation(destination);
        if !allowed { note_browser_event("popup navigation refused", destination); }
        allowed
    })
    // Some email tracking pages create yet another window after the initial
    // blank popup. Do not swallow that follow-up browser request either.
    .on_new_window(move |url, features| {
        create_email_popup(&nested_app, url, features)
    });
    match builder.build() {
        Ok(window) => {
            note_browser_event("opened browser popup", &target);
            NewWindowResponse::Create { window }
        }
        Err(_) => {
            eprintln!("[Claude email browser] Could not create link popup");
            NewWindowResponse::Deny
        }
    }
}

fn ensure_mail(app: &AppHandle, url: tauri::Url) -> Result<tauri::Webview, String> {
    if let Some(view) = app.get_webview(MAIL_LABEL) {
        view.navigate(url).map_err(|e| e.to_string())?;
        return Ok(view);
    }
    let window = app.get_window(WINDOW_LABEL)
        .ok_or_else(|| "Claude provider window is closed".to_string())?;
    let (position, size) = content_bounds(&window)?;
    let nav_app = app.clone();
    let popup_app = app.clone();
    let view = window.add_child(
        WebviewBuilder::new(MAIL_LABEL, WebviewUrl::External(url))
            // No Workbench scripts, DOM probes, cookies/storage reads, or
            // content capture in this unrelated third-party email view.
            .on_navigation(move |target| {
                if is_claude_link(target) {
                    send_magic_link_to_claude(nav_app.clone(), target.clone(), None);
                    return false;
                }
                let allowed = safe_browser_navigation(target);
                if !allowed { note_browser_event("mail navigation refused", target); }
                allowed
            })
            .on_new_window(move |target, features| {
                create_email_popup(&popup_app, target, features)
            }),
        position,
        size,
    ).map_err(|e| e.to_string())?;
    Ok(view)
}

fn show_email(app: &AppHandle) -> Result<(), String> {
    let mail = app.get_webview(MAIL_LABEL)
        .ok_or_else(|| "Open a webmail address first".to_string())?;
    mail.show().map_err(|e| e.to_string())?;
    if let Some(claude) = app.get_webview(CLAUDE_LABEL) {
        claude.hide().map_err(|e| e.to_string())?;
    }
    notify_active(app, "email");
    Ok(())
}

#[tauri::command]
pub(crate) async fn claude_auth_tab_open_email(
    app: AppHandle, webview: tauri::Webview, address: String,
) -> Result<(), String> {
    trusted_toolbar(&webview)?;
    let url = safe_webmail_url(&address)?;
    if is_claude_link(&url) {
        let claude = app.get_webview(CLAUDE_LABEL)
            .ok_or_else(|| "Claude window is unavailable".to_string())?;
        claude.navigate(url).map_err(|e| e.to_string())?;
        return show_claude(&app);
    }
    ensure_mail(&app, url)?;
    show_email(&app)
}

#[tauri::command]
pub(crate) async fn claude_auth_tab_switch(
    app: AppHandle, webview: tauri::Webview, tab: String,
) -> Result<(), String> {
    trusted_toolbar(&webview)?;
    match tab.as_str() {
        "claude" => show_claude(&app),
        "email" => show_email(&app),
        _ => Err("Invalid Claude login tab".into()),
    }
}

#[tauri::command]
pub(crate) async fn claude_auth_tab_close_email(
    app: AppHandle, webview: tauri::Webview,
) -> Result<(), String> {
    trusted_toolbar(&webview)?;
    let _ = show_claude(&app);
    if let Some(mail) = app.get_webview(MAIL_LABEL) {
        mail.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn close_tabs(app: &AppHandle) {
    for label in [MAIL_LABEL, TOOLBAR_LABEL] {
        if let Some(view) = app.get_webview(label) {
            let _ = view.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_claude_link, is_gmail_mail_route, safe_browser_navigation, safe_webmail_url};

    #[test]
    fn only_https_no_authority_credentials_or_custom_ports() {
        for url in [
            "http://mail.google.com", "file:///etc/passwd",
            "https://user:pass@mail.google.com/", "https://mail.google.com:444/",
            "javascript:alert(1)", "http://localhost:3000",
        ] {
            assert!(safe_webmail_url(url).is_err(), "{url}");
        }
        assert_eq!(
            safe_webmail_url("mail.google.com").unwrap().as_str(),
            "https://mail.google.com/"
        );
    }

    #[test]
    fn email_popups_may_start_blank_before_redirecting() {
        assert!(safe_browser_navigation(&"about:blank".parse().unwrap()));
        assert!(safe_browser_navigation(&"about:srcdoc".parse().unwrap()));
        assert!(safe_browser_navigation(&"https://mail.google.com/".parse().unwrap()));
        assert!(!safe_browser_navigation(&"javascript:alert(1)".parse().unwrap()));
        assert!(!safe_browser_navigation(&"file:///private/secret".parse().unwrap()));
        assert!(!safe_browser_navigation(&"about:config".parse().unwrap()));
    }

    #[test]
    fn gmail_account_switch_stays_in_the_email_tab() {
        for url in [
            "https://mail.google.com/mail/u/0/",
            "https://mail.google.com/mail/u/1/#inbox",
            "https://mail.google.com/mail/u/2/?authuser=2",
            "https://mail.google.com/mail/",
        ] {
            assert!(is_gmail_mail_route(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "https://accounts.google.com/AccountChooser?continue=https://mail.google.com/",
            "https://mail.google.com.evil.example/mail/u/1/",
            "https://evil.example/mail/u/1/",
            "http://mail.google.com/mail/u/1/",
            "https://mail.google.com:8443/mail/u/1/",
            "https://name@mail.google.com/mail/u/1/",
            "https://mail.google.com/calendar/u/1/",
            "about:blank",
        ] {
            assert!(!is_gmail_mail_route(&url.parse().unwrap()), "{url}");
        }
    }

    #[test]
    fn magic_links_must_match_exact_claude_origin() {
        assert!(is_claude_link(&"https://claude.ai/auth/verify?token=secret".parse().unwrap()));
        for url in [
            "http://claude.ai/auth", "https://evil-claude.ai/auth",
            "https://claude.ai.evil.test/auth",
            "https://claude.ai:8443/auth", "https://claude.ai@evil.test/",
        ] {
            assert!(!is_claude_link(&url.parse().unwrap()), "{url}");
        }
    }
}
