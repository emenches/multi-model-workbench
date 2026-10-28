// Native WebView security, navigation and lifecycle regression tests.
use std::sync::Mutex;

use crate::adapters;
use tauri::{PhysicalPosition, PhysicalSize};

use super::{
    accept_status_for_session_reset, adopt_grok_bridge_boot, bridge_resets_on_boot_rotation,
    CHATGPT_BRIDGE_HEALTH_JS,
    cancel_grok_navigation, cancel_grok_popup_recovery, cancel_session_reset,
    challenge_auxiliary_navigation_allowed, claim_grok_popup_recovery, confirm_grok_page_load,
    decide_new_window_action, external_handoff_allowed, chatgpt_renderer_auxiliary_url,
    allow_chatgpt_renderer_navigation, chatgpt_renderer_replaced_top_level,
    delayed_grok_bridge_script, eval_callback_reports_true,
    expire_grok_navigation_start_lease, fresh_session_boot, gemini_sorry_navigation_active,
    generic_staleness_dispatch_allowed, grok_app_title_ready,
    grok_auth_popup_may_complete_login, grok_bridge_drive_allowed, grok_bridge_host_action,
    grok_bridge_install_ready, grok_bridge_result_is_current, grok_challenge_title_active,
    grok_document_title_signal, grok_external_auth_handoff_needs_app_return,
    grok_external_auth_return_is_current, grok_popup_recovery_claim_is_current,
    grok_popup_recovery_needed, grok_reconnect_allowed, grok_stale_reason,
    parse_grok_bridge_drive_outcome, physical_bounds, popup_initial_title,
    prepare_grok_external_auth_return, prepare_grok_navigation, prepare_grok_popup_recovery,
    provider_document_allows_generic_eval, provider_show_should_focus,
    provider_state_allows_control_eval, stale_chatgpt_bridge_eval_allowed, provider_uses_document_start_bridge,
    provider_uses_permission_shim, record_grok_bridge_challenge, reset_state_for_page_load,
    retire_grok_document, runtime, should_drive_grok_bridge,
    should_drive_grok_bridge_from_background, should_reset_bridge_on_boot_rotation,
    staleness_action, state_with, Bounds, GrokBridgeDriveOutcome, GrokBridgeDriveResult,
    GrokBridgeHostAction, GrokDocumentTitleSignal, GrokNavigationOwner, NewWindowAction,
    StalenessAction, CHALLENGE_SIGNALS_JSON, GROK_APP_TITLE_UNCONFIRMED_REASON,
    PERMISSION_SHIM_JS, PROVIDER_BROWSER_ARGS,
};

static GROK_RUNTIME_TEST_LOCK: Mutex<()> = Mutex::new(());

fn url(input: &str) -> tauri::Url {
    tauri::Url::parse(input).expect("test URL should parse")
}

#[test]
fn typed_provider_commands_never_accept_arbitrary_javascript() {
    for action in ["eval", "javascript", "cookie", "navigate", "reload", "execute"] {
        assert!(super::build_provider_control_script("chatgpt", action, None, None).is_err());
    }
    assert!(super::provider_bridge_read_script("document.cookie").is_err());
    assert!(super::provider_bridge_read_script("location").is_err());
    assert_eq!(
        super::provider_bridge_read_script("peek").unwrap(),
        super::CHATGPT_BRIDGE_PEEK_JS
    );
    assert_eq!(
        super::provider_bridge_read_script("health").unwrap(),
        super::CHATGPT_BRIDGE_HEALTH_JS
    );
    assert!(super::build_provider_control_script("chatgpt", "ack", None, Some(0)).is_err());
    assert!(super::build_provider_control_script("chatgpt", "ack", None, Some(9_007_199_254_740_992)).is_err());
    assert!(super::build_provider_control_script("chatgpt", "send", Some("x"), Some(1)).is_err());
    assert!(super::build_provider_control_script("chatgpt", "stop", Some("x"), None).is_err());
    assert!(super::build_provider_control_script("chatgpt", "send", Some(&"x".repeat(1024 * 1024 + 1)), None).is_err());
}

#[test]
fn typed_send_encodes_untrusted_text_as_data_not_script_source() {
    let prompt = r#"</script>\");window.alert('injection');//"#;
    let script = super::build_provider_control_script("claude", "send", Some(prompt), None)
        .expect("valid send");
    let payload = script
        .strip_prefix("window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(")
        .and_then(|rest| rest.strip_suffix(");"))
        .expect("fixed JS dispatcher");
    let data: serde_json::Value = serde_json::from_str(payload).expect("valid data payload");
    assert_eq!(data["action"], "SEND_MESSAGE");
    assert_eq!(data["provider"], "claude");
    assert_eq!(data["payload"]["text"], prompt);
    let fill = super::build_provider_control_script("claude", "fill", Some(prompt), None).unwrap();
    assert!(fill.contains("FILL_DRAFT"));
    assert!(!fill.contains("SEND_MESSAGE"));
}

#[test]
fn provider_browser_args_keep_hidden_automation_responsive() {
    assert!(PROVIDER_BROWSER_ARGS.contains("--disable-background-timer-throttling"));
    assert!(PROVIDER_BROWSER_ARGS.contains("--disable-renderer-backgrounding"));
    assert!(PROVIDER_BROWSER_ARGS.contains("--disable-backgrounding-occluded-windows"));
    assert!(PROVIDER_BROWSER_ARGS.contains("msSmartScreenProtection"));
}

#[test]
fn provider_show_requires_an_explicit_focus_request() {
    assert!(!provider_show_should_focus(None));
    assert!(!provider_show_should_focus(Some(false)));
    assert!(provider_show_should_focus(Some(true)));
}

#[test]
fn grok_keeps_core_web_apis_unmodified_for_cloudflare_challenges() {
    assert!(!provider_uses_permission_shim("grok"));
    assert!(!provider_uses_document_start_bridge("grok"));
    for provider in ["chatgpt", "gemini"] {
        assert!(provider_uses_permission_shim(provider));
        assert!(provider_uses_document_start_bridge(provider));
    }
    // Claude's separately verified clean WKWebView login requires the same
    // no-modification policy until its authenticated chat composer appears.
    assert!(!provider_uses_permission_shim("claude"));
    assert!(!provider_uses_document_start_bridge("claude"));
}

#[test]
fn grok_bridge_waits_for_the_real_app_and_an_atomic_negative_challenge_check() {
    assert!(grok_app_title_ready("grok", "Grok"));
    assert!(grok_app_title_ready("grok", "Grok — Home"));
    assert!(!grok_app_title_ready("grok", "grok.com 正在執行安全驗證"));
    assert!(!grok_app_title_ready("grok", "Just a moment..."));
    assert!(!grok_app_title_ready("chatgpt", "Grok"));
    assert!(grok_bridge_install_ready(
        "grok",
        "Grok",
        &url("https://grok.com/")
    ));
    assert!(!grok_bridge_install_ready(
        "grok",
        "Grok",
        &url("https://accounts.x.ai/sign-in")
    ));

    let script = delayed_grok_bridge_script("grok").expect("delayed script should build");
    assert!(!script.contains("__MAC_GROK_DELAYED_INSTALL__"));
    assert!(script.contains("location.hostname !== 'grok.com'"));
    assert!(script.contains("challenges.cloudflare.com"));
    assert!(script.contains("function installEngineAndAdapter()"));
    assert!(script.contains("ADAPTER_UPDATE"));
    assert!(script.contains("CHECK_STATUS"));
    assert!(script.contains("window.__MAC_APP_HOSTS__ = [\"grok.com\"]"));
    assert!(script.contains("正在執行安全驗證"));
    assert!(script.contains("bootId: String(window.__MAC_BRIDGE__.bootId || '')"));
    let challenge_check = script
        .find("if (challengeActive()) return { outcome: 'challenge' };")
        .expect("driver must check the challenge");
    let first_provider_write = script
        .find("window.__MAC_PROVIDER__ =")
        .expect("driver must eventually identify the provider");
    assert!(challenge_check < first_provider_write);
    serde_json::from_str::<serde_json::Value>(CHALLENGE_SIGNALS_JSON)
        .expect("shared challenge signals must remain valid JSON");
}

#[test]
fn grok_allows_only_cloudflare_auxiliary_about_documents() {
    assert!(challenge_auxiliary_navigation_allowed(
        "grok",
        &url("about:blank")
    ));
    assert!(challenge_auxiliary_navigation_allowed(
        "grok",
        &url("about:srcdoc")
    ));
    assert!(!challenge_auxiliary_navigation_allowed(
        "chatgpt",
        &url("about:blank")
    ));
    assert!(!challenge_auxiliary_navigation_allowed(
        "grok",
        &url("data:text/plain,hello")
    ));
    assert!(!challenge_auxiliary_navigation_allowed(
        "grok",
        &url("javascript:alert(1)")
    ));
    assert!(!challenge_auxiliary_navigation_allowed(
        "grok",
        &url("about:config")
    ));
}

#[test]
fn grok_returns_to_its_app_only_after_the_exact_denied_xai_auth_handoff() {
    let denied_popup = url("https://auth.x.ai/oauth/authorize?state=test");
    assert!(grok_external_auth_handoff_needs_app_return(
        "grok",
        &denied_popup
    ));
    assert_eq!(
        decide_new_window_action(&denied_popup, false),
        NewWindowAction::DenyExternal
    );
    for (provider, value) in [
        ("chatgpt", "https://auth.x.ai/oauth/authorize"),
        ("grok", "http://auth.x.ai/oauth/authorize"),
        ("grok", "https://auth.x.ai:8443/oauth/authorize"),
        ("grok", "https://user:pass@auth.x.ai/oauth/authorize"),
        ("grok", "https://auth.x.ai.evil.net/oauth/authorize"),
    ] {
        assert!(
            !grok_external_auth_handoff_needs_app_return(provider, &url(value)),
            "{provider} {value}"
        );
    }
}

#[test]
fn new_window_allowlisted_google_oauth_allows_popup() {
    assert_eq!(
        decide_new_window_action(
            &url("https://accounts.google.com/o/oauth2/v2/auth?client_id=test"),
            true
        ),
        NewWindowAction::AllowPopup
    );
}

#[test]
fn grok_popup_recovery_is_limited_to_auth_hosts() {
    assert!(grok_auth_popup_may_complete_login(
        "grok",
        &url("https://accounts.google.com/o/oauth2/v2/auth?client_id=test")
    ));
    assert!(grok_auth_popup_may_complete_login(
        "grok",
        &url("https://auth.grokusercontent.com/api/auth/callback/google")
    ));
    assert!(!grok_auth_popup_may_complete_login(
        "grok",
        &url("https://grok.com/chat")
    ));
    assert!(!grok_auth_popup_may_complete_login(
        "grok",
        &url("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b")
    ));
    assert!(!grok_auth_popup_may_complete_login(
        "chatgpt",
        &url("https://accounts.google.com/o/oauth2/v2/auth")
    ));
}

#[test]
fn grok_popup_recovery_requires_the_same_blocked_document() {
    let blocked = state_with("grok", "loaded", "unknown", "blocked", false);
    assert!(grok_popup_recovery_needed(&blocked, 7, 7, false));
    assert!(!grok_popup_recovery_needed(&blocked, 6, 7, false));
    assert!(!grok_popup_recovery_needed(&blocked, 7, 7, true));

    let ready = state_with("grok", "loaded", "ready", "logged_in", false);
    assert!(!grok_popup_recovery_needed(&ready, 7, 7, false));
    let logged_out = state_with("grok", "loaded", "unknown", "logged_out", false);
    assert!(!grok_popup_recovery_needed(&logged_out, 7, 7, false));
    let other_provider = state_with("chatgpt", "loaded", "unknown", "blocked", false);
    assert!(!grok_popup_recovery_needed(&other_provider, 7, 7, false));
}

#[test]
fn popup_initial_title_never_exposes_oauth_query_parameters() {
    let oauth =
        url("https://accounts.google.com/o/oauth2/v2/auth?client_id=secret&state=sensitive");
    assert_eq!(popup_initial_title(&oauth), "accounts.google.com");
    assert_eq!(popup_initial_title(&url("about:blank")), "Sign in");
}

#[test]
fn physical_bounds_round_valid_values_and_allow_negative_positions() {
    let (position, size) = physical_bounds(&Bounds {
        x: -10.4,
        y: 0.0,
        width: 640.6,
        height: 479.5,
    })
    .expect("valid bounds should convert");

    assert_eq!(position, PhysicalPosition::new(-10, 0));
    assert_eq!(size, PhysicalSize::new(641, 480));
}

#[test]
fn physical_bounds_reject_non_finite_values() {
    for field in 0..4 {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut bounds = Bounds {
                x: 10.0,
                y: 20.0,
                width: 640.0,
                height: 480.0,
            };
            match field {
                0 => bounds.x = invalid,
                1 => bounds.y = invalid,
                2 => bounds.width = invalid,
                _ => bounds.height = invalid,
            }
            assert!(physical_bounds(&bounds).is_err());
        }
    }
}

#[test]
fn physical_bounds_reject_invalid_sizes_and_out_of_range_positions() {
    for invalid_size in [0.0, -1.0, 0.49, u32::MAX as f64 + 1.0] {
        for bounds in [
            Bounds {
                x: 0.0,
                y: 0.0,
                width: invalid_size,
                height: 480.0,
            },
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 640.0,
                height: invalid_size,
            },
        ] {
            assert!(physical_bounds(&bounds).is_err());
        }
    }
    for bounds in [
        Bounds {
            x: i32::MAX as f64 + 1.0,
            y: 0.0,
            width: 640.0,
            height: 480.0,
        },
        Bounds {
            x: 0.0,
            y: i32::MIN as f64 - 1.0,
            width: 640.0,
            height: 480.0,
        },
    ] {
        assert!(physical_bounds(&bounds).is_err());
    }

    let (position, size) = physical_bounds(&Bounds {
        x: i32::MIN as f64,
        y: i32::MAX as f64,
        width: 1.0,
        height: u32::MAX as f64,
    })
    .expect("exact integer limits should remain valid");
    assert_eq!(position, PhysicalPosition::new(i32::MIN, i32::MAX));
    assert_eq!(size, PhysicalSize::new(1, u32::MAX));
}

#[test]
fn chatgpt_renderer_is_an_internal_subresource_not_a_browser_popup() {
    let renderer = url("https://cdn.platform.openai.com/deployments/dil/v14/runner.html");
    assert!(chatgpt_renderer_auxiliary_url("chatgpt", &renderer));
    assert!(!chatgpt_renderer_auxiliary_url("claude", &renderer));
    assert!(!chatgpt_renderer_auxiliary_url("chatgpt", &url("http://cdn.platform.openai.com/deployments/dil/v14/runner.html")));
    assert!(!chatgpt_renderer_auxiliary_url("chatgpt", &url("https://cdn.platform.openai.com/other/runner.html")));
    assert!(!chatgpt_renderer_auxiliary_url("chatgpt", &url("https://example.com/deployments/dil/v14/runner.html")));
}

#[test]
fn chatgpt_dil_runner_requires_trusted_main_page_and_exact_resource() {
    let chat = url("https://chatgpt.com/c/real-conversation");
    let renderer = url("https://cdn.platform.openai.com/deployments/dil/v14/runner.html");
    assert!(allow_chatgpt_renderer_navigation("chatgpt", &renderer, &chat));
    assert!(!allow_chatgpt_renderer_navigation("claude", &renderer, &chat));
    assert!(!allow_chatgpt_renderer_navigation("chatgpt", &renderer, &url("https://example.com/")));
    assert!(!allow_chatgpt_renderer_navigation("chatgpt", &renderer, &renderer));
    assert!(!allow_chatgpt_renderer_navigation("chatgpt", &url("https://cdn.platform.openai.com/other/runner.html"), &chat));
    assert!(!allow_chatgpt_renderer_navigation("chatgpt", &url("http://cdn.platform.openai.com/deployments/dil/v14/runner.html"), &chat));
}

#[test]
fn chatgpt_dil_runner_cannot_remain_the_top_level_page() {
    let renderer = url("https://cdn.platform.openai.com/deployments/dil/v14/runner.html");
    let chat = url("https://chatgpt.com/c/real-conversation");
    assert!(!chatgpt_renderer_replaced_top_level("chatgpt", &renderer, &chat));
    assert!(chatgpt_renderer_replaced_top_level("chatgpt", &renderer, &renderer));
    assert!(!chatgpt_renderer_replaced_top_level("claude", &renderer, &renderer));
}

#[test]
fn provider_generated_external_links_do_not_launch_browser() {
    for provider in ["chatgpt", "claude", "gemini", "grok", "meta"] {
        assert!(!external_handoff_allowed(provider, &url("https://example.com/popups")));
        assert!(!external_handoff_allowed(provider, &url("https://challenges.cloudflare.com/turnstile")));
        assert!(!external_handoff_allowed(provider, &url("https://accounts.google.com/unexpected")));
    }
    // Preserve the narrow Grok external-auth recovery exception.
    assert!(external_handoff_allowed("grok", &url("https://auth.x.ai/oauth/authorize?state=test")));
    assert!(!external_handoff_allowed("gemini", &url("https://auth.x.ai/oauth/authorize?state=test")));
    assert_eq!(decide_new_window_action(&url("https://accounts.google.com/o/oauth2/v2/auth"), true), NewWindowAction::AllowPopup);
    assert_eq!(decide_new_window_action(&url("https://challenges.cloudflare.com/turnstile"), false), NewWindowAction::DenyExternal);
}

#[test]
fn gemini_app_popups_are_not_sso_popups() {
    let app = url("https://gemini.google.com/app");
    let google_sign_in = url("https://accounts.google.com/o/oauth2/v2/auth");
    assert!(adapters::url_allowed_for_provider("gemini", &app).unwrap());
    assert!(!adapters::url_allowed_for_sso("gemini", &app).unwrap());
    assert!(adapters::url_allowed_for_sso("gemini", &google_sign_in).unwrap());
}

#[test]
fn new_window_allowlisted_provider_app_allows_popup() {
    assert_eq!(
        decide_new_window_action(&url("https://grok.com/chat"), true),
        NewWindowAction::AllowPopup
    );
}

#[test]
fn new_window_non_allowlisted_https_goes_external() {
    assert_eq!(
        decide_new_window_action(&url("https://evil.example/phish"), false),
        NewWindowAction::DenyExternal
    );
}

#[test]
fn new_window_non_allowlisted_http_goes_external() {
    assert_eq!(
        decide_new_window_action(&url("http://evil.example/"), false),
        NewWindowAction::DenyExternal
    );
}

#[test]
fn new_window_sentinel_silently_denied_even_if_allowlisted() {
    assert_eq!(
        decide_new_window_action(&url("https://mac-bridge.invalid/bridge"), false),
        NewWindowAction::DenySilent
    );
    assert_eq!(
        decide_new_window_action(&url("https://mac-bridge.invalid/bridge"), true),
        NewWindowAction::DenySilent
    );
}

#[test]
fn new_window_non_http_non_allowlisted_silently_denied() {
    assert_eq!(
        decide_new_window_action(&url("about:blank"), false),
        NewWindowAction::DenySilent
    );
    assert_eq!(
        decide_new_window_action(&url("data:text/plain,hello"), false),
        NewWindowAction::DenySilent
    );
}

#[test]
fn new_window_allowlisted_true_never_goes_external() {
    assert_eq!(
        decide_new_window_action(&url("http://evil.example/"), true),
        NewWindowAction::AllowPopup
    );
    assert_eq!(
        decide_new_window_action(&url("data:text/plain,hello"), true),
        NewWindowAction::AllowPopup
    );
}

#[test]
fn staleness_before_30s_does_nothing() {
    assert_eq!(staleness_action(1_000, 30_999, true), StalenessAction::None);
}

#[test]
fn staleness_30_to_40s_dispatches_check() {
    assert_eq!(
        staleness_action(1_000, 31_000, true),
        StalenessAction::DispatchCheck
    );
    assert_eq!(
        staleness_action(1_000, 41_000, true),
        StalenessAction::DispatchCheck
    );
}

#[test]
fn staleness_after_40s_marks_unknown() {
    assert_eq!(
        staleness_action(1_000, 41_001, true),
        StalenessAction::MarkUnknown
    );
}

#[test]
fn staleness_not_loaded_does_nothing() {
    assert_eq!(
        staleness_action(1_000, 60_000, false),
        StalenessAction::None
    );
}

#[test]
fn grok_reconnect_requires_an_old_unresolved_safe_state() {
    let mut stale = state_with("grok", "loaded", "unknown", "unknown", false);
    stale.last_status_at = 1_000;
    stale.bridge = "ok".into();
    stale.adapter = "ok".into();

    assert!(!grok_reconnect_allowed(&stale, 41_000));
    assert!(grok_reconnect_allowed(&stale, 41_001));

    let mut signed_in = stale.clone();
    signed_in.login = "logged_in".into();
    assert!(grok_reconnect_allowed(&signed_in, 41_001));

    let mut blocked = stale.clone();
    blocked.login = "blocked".into();
    assert!(!grok_reconnect_allowed(&blocked, 41_001));

    let mut logged_out = stale.clone();
    logged_out.login = "logged_out".into();
    assert!(!grok_reconnect_allowed(&logged_out, 41_001));

    let mut thinking = stale.clone();
    thinking.thinking = true;
    assert!(!grok_reconnect_allowed(&thinking, 41_001));

    let mut healthy = stale.clone();
    healthy.dom = "ready".into();
    assert!(!grok_reconnect_allowed(&healthy, 41_001));

    let mut degraded = stale.clone();
    degraded.bridge = "degraded".into();
    assert!(!grok_reconnect_allowed(&degraded, 41_001));

    let mut broken = stale.clone();
    broken.adapter = "broken".into();
    assert!(!grok_reconnect_allowed(&broken, 41_001));

    let mut other_provider = stale;
    other_provider.provider = "chatgpt".into();
    assert!(!grok_reconnect_allowed(&other_provider, 41_001));
}

#[test]
fn grok_stale_reason_requires_missing_current_app_title_and_is_emitted_once() {
    let mut stale = state_with("grok", "loaded", "unknown", "unknown", false);
    stale.last_status_at = 1_000;
    stale.bridge = "ok".into();
    stale.adapter = "ok".into();

    assert_eq!(
        grok_stale_reason(&stale, 41_001, false),
        Some(GROK_APP_TITLE_UNCONFIRMED_REASON)
    );
    assert_eq!(grok_stale_reason(&stale, 41_001, true), None);

    stale.bridge_reason = Some(GROK_APP_TITLE_UNCONFIRMED_REASON.into());
    assert_eq!(grok_stale_reason(&stale, 41_001, false), None);
}

#[test]
fn degraded_bridge_resets_only_on_new_boot() {
    assert!(!bridge_resets_on_boot_rotation(
        "degraded",
        None,
        Some("boot-b")
    ));
    assert!(!bridge_resets_on_boot_rotation(
        "degraded",
        Some("boot-a"),
        None
    ));
    assert!(!bridge_resets_on_boot_rotation(
        "degraded",
        Some("boot-b"),
        Some("boot-b")
    ));
    assert!(bridge_resets_on_boot_rotation(
        "degraded",
        Some("boot-a"),
        Some("boot-b")
    ));
    assert!(!bridge_resets_on_boot_rotation(
        "ok",
        Some("boot-a"),
        Some("boot-b")
    ));
}

#[test]
fn gemini_google_sorry_navigation_is_narrow_and_unmodified() {
    assert!(gemini_sorry_navigation_active(
        "gemini",
        &url("https://www.google.com/sorry")
    ));
    assert!(gemini_sorry_navigation_active(
        "gemini",
        &url(
            "https://www.google.com/sorry/index?continue=https%3A%2F%2Fgemini.google.com%2Fapp"
        )
    ));
    for value in [
        "https://www.google.com/sorryevil",
        "https://www.google.com/search",
        "https://www.google.com.evil.net/sorry",
        "http://www.google.com/sorry",
    ] {
        assert!(!gemini_sorry_navigation_active("gemini", &url(value)));
    }
    assert!(!gemini_sorry_navigation_active(
        "chatgpt",
        &url("https://www.google.com/sorry")
    ));
    assert!(PERMISSION_SHIM_JS.contains("location.hostname === 'www.google.com'"));
    assert!(PERMISSION_SHIM_JS.contains("location.pathname === '/sorry'"));
}

#[test]
fn grok_challenge_titles_surface_without_enabling_other_providers() {
    for title in [
        "Just a moment...",
        "Performing security verification",
        "grok.com 正在執行安全驗證",
        "安全性驗證",
        "セキュリティ検証",
        "Sicherheitsüberprüfung",
    ] {
        assert!(grok_challenge_title_active("grok", title));
    }
    assert!(!grok_challenge_title_active("grok", "Grok"));
    assert!(!grok_challenge_title_active(
        "chatgpt",
        "Performing security verification"
    ));
}

#[test]
fn grok_challenge_title_wins_when_it_also_looks_like_an_app_title() {
    assert_eq!(
        grok_document_title_signal(
            "grok",
            "Grok — Performing security verification",
            &url("https://grok.com/")
        ),
        GrokDocumentTitleSignal::Challenge
    );
    assert_eq!(
        grok_document_title_signal("grok", "Grok — Home", &url("https://grok.com/")),
        GrokDocumentTitleSignal::App
    );
}

#[test]
fn grok_bridge_driver_callback_parses_only_known_outcomes() {
    assert_eq!(
        parse_grok_bridge_drive_outcome(r#""challenge""#),
        Some(GrokBridgeDriveResult {
            outcome: GrokBridgeDriveOutcome::Challenge,
            boot_id: None,
        })
    );
    assert_eq!(
        parse_grok_bridge_drive_outcome(r#""\"installed\"""#),
        Some(GrokBridgeDriveResult {
            outcome: GrokBridgeDriveOutcome::Installed,
            boot_id: None,
        })
    );
    assert_eq!(
        parse_grok_bridge_drive_outcome(
            r#""{\"outcome\":\"present\",\"bootId\":\"boot-current\"}""#
        ),
        Some(GrokBridgeDriveResult {
            outcome: GrokBridgeDriveOutcome::Present,
            boot_id: Some("boot-current".into()),
        })
    );
    assert_eq!(parse_grok_bridge_drive_outcome("null"), None);
    assert_eq!(parse_grok_bridge_drive_outcome(r#""unexpected""#), None);
}

#[test]
fn grok_bridge_driver_structural_gate_accepts_loaded_unresolved_states() {
    assert!(should_drive_grok_bridge(&state_with(
        "grok", "loaded", "unknown", "unknown", false
    )));
    assert!(should_drive_grok_bridge(&state_with(
        "grok", "loaded", "unknown", "blocked", false
    )));
    assert!(!should_drive_grok_bridge(&state_with(
        "grok",
        "loaded",
        "ready",
        "logged_in",
        false
    )));
    assert!(!should_drive_grok_bridge(&state_with(
        "grok", "creating", "unknown", "unknown", false
    )));
    assert!(!should_drive_grok_bridge(&state_with(
        "chatgpt", "loaded", "unknown", "unknown", false
    )));
    assert!(grok_bridge_drive_allowed(&state_with(
        "grok", "creating", "unknown", "unknown", false
    )));
    // The blocked state must stay drive-eligible for the app-title recovery path.
    assert!(grok_bridge_drive_allowed(&state_with(
        "grok", "loaded", "unknown", "blocked", false
    )));
}

#[test]
fn grok_page_load_and_watchdog_require_a_positive_app_title_signal() {
    let unresolved = state_with("grok", "loaded", "unknown", "unknown", false);
    assert!(!should_drive_grok_bridge_from_background(
        &unresolved,
        false
    ));
    assert!(should_drive_grok_bridge_from_background(&unresolved, true));

    // A positive title is the recovery authorization. Keep the UI blocked until the bridge
    // confirms status, but allow Finished/watchdog to retry if the first title-time drive
    // returned "waiting" while the real app document was still loading.
    let blocked = state_with("grok", "loaded", "unknown", "blocked", false);
    assert!(!should_drive_grok_bridge_from_background(&blocked, false));
    assert!(should_drive_grok_bridge_from_background(&blocked, true));
    assert!(grok_bridge_drive_allowed(&blocked));
}

#[test]
fn grok_generic_staleness_requires_an_app_title_and_skips_blocked() {
    assert!(!generic_staleness_dispatch_allowed(
        &state_with("grok", "loaded", "unknown", "blocked", false),
        false
    ));
    assert!(!generic_staleness_dispatch_allowed(
        &state_with("grok", "loaded", "unknown", "unknown", false),
        false
    ));
    assert!(generic_staleness_dispatch_allowed(
        &state_with("grok", "loaded", "unknown", "unknown", false),
        true
    ));
    assert!(generic_staleness_dispatch_allowed(
        &state_with("grok", "loaded", "unknown", "blocked", false),
        true
    ));
    assert!(generic_staleness_dispatch_allowed(
        &state_with("chatgpt", "loaded", "unknown", "blocked", false),
        false
    ));
}

#[test]
fn generic_eval_requires_an_app_document_and_a_current_grok_bridge() {
    let ready = state_with("grok", "loaded", "ready", "logged_in", false);
    assert!(!provider_document_allows_generic_eval(
        "grok",
        false,
        Some(&ready),
        7,
        Some(7),
        Some(7),
        false
    ));
    assert!(!provider_document_allows_generic_eval(
        "grok",
        true,
        Some(&ready),
        7,
        None,
        Some(7),
        false
    ));
    assert!(!provider_document_allows_generic_eval(
        "grok",
        true,
        Some(&ready),
        7,
        Some(7),
        Some(6),
        false
    ));
    assert!(!provider_document_allows_generic_eval(
        "grok",
        true,
        Some(&ready),
        7,
        Some(7),
        Some(7),
        true
    ));
    assert!(provider_document_allows_generic_eval(
        "grok",
        true,
        Some(&ready),
        7,
        Some(7),
        Some(7),
        false
    ));

    let blocked = state_with("grok", "loaded", "unknown", "blocked", false);
    assert!(!provider_document_allows_generic_eval(
        "grok",
        true,
        Some(&blocked),
        7,
        Some(7),
        Some(7),
        false
    ));
    assert!(provider_document_allows_generic_eval(
        "chatgpt", true, None, 0, None, None, false
    ));
    assert!(!provider_document_allows_generic_eval(
        "chatgpt", false, None, 0, None, None, false
    ));
}

#[test]
fn control_eval_requires_a_ready_non_challenge_document() {
    assert!(provider_state_allows_control_eval(&state_with(
        "chatgpt",
        "loaded",
        "ready",
        "logged_in",
        false
    )));
    assert!(!provider_state_allows_control_eval(&state_with(
        "chatgpt",
        "loaded",
        "unknown",
        "logged_in",
        false
    )));
    assert!(!provider_state_allows_control_eval(&state_with(
        "grok", "loaded", "ready", "blocked", false
    )));
}


#[test]
fn stale_chatgpt_allows_only_internal_bridge_read_and_ack() {
    let stale = state_with("chatgpt", "loaded", "unknown", "logged_in", false);
    let ready = state_with("chatgpt", "loaded", "ready", "logged_in", false);
    let blocked = state_with("chatgpt", "loaded", "unknown", "blocked", false);
    let unmounted = state_with("chatgpt", "none", "unknown", "logged_in", false);

    let peek = "window.__MAC_BRIDGE__ ? window.__MAC_BRIDGE__.peekOutbox() : []";
    let ack = "window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.ackBulk(99);";

    assert!(stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, peek, true));
    assert!(stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, CHATGPT_BRIDGE_HEALTH_JS, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, CHATGPT_BRIDGE_HEALTH_JS, false));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &blocked, CHATGPT_BRIDGE_HEALTH_JS, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("gemini", &stale, CHATGPT_BRIDGE_HEALTH_JS, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, "window.__MAC_ENGINE__", true));
    assert!(stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, ack, false));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, peek, false));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, ack, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, "window.location.reload()", false));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, "window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.ackBulk(0);", false));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &stale, "window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.ackBulk(1);alert(1)", false));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &ready, peek, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &blocked, peek, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("chatgpt", &unmounted, peek, true));
    assert!(!stale_chatgpt_bridge_eval_allowed("grok", &stale, peek, true));
}

#[test]
fn page_load_start_immediately_makes_a_ready_provider_non_sendable() {
    let mut state = state_with("chatgpt", "loaded", "ready", "logged_in", true);
    state.bridge = "degraded".into();
    state.bridge_reason = Some("stale".into());
    reset_state_for_page_load(&mut state);
    assert_eq!(state.webview, "loaded");
    assert_eq!(state.dom, "unknown");
    assert_eq!(state.login, "logged_in");
    assert!(!state.thinking);
    assert_eq!(state.bridge, "ok");
    assert_eq!(state.bridge_reason, None);
    assert!(!provider_state_allows_control_eval(&state));
}

#[test]
fn body_detected_grok_challenge_revokes_the_positive_title_epoch() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.states.insert(
            provider.into(),
            state_with(provider, "loaded", "unknown", "unknown", false),
        );
        guard.grok_document_epoch.insert(provider.into(), 9);
        guard.grok_app_title_epoch.insert(provider.into(), 9);
        guard.grok_pending_navigation.remove(provider);
    }

    let blocked =
        record_grok_bridge_challenge(provider, 9).expect("current challenge should apply");
    assert_eq!(blocked.login, "blocked");
    let guard = runtime().lock().expect("provider runtime lock");
    assert!(!guard.grok_app_title_epoch.contains_key(provider));
    drop(guard);
    assert!(!should_drive_grok_bridge_from_background(&blocked, false));

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.states.remove(provider);
    guard.grok_document_epoch.remove(provider);
    guard.grok_app_title_epoch.remove(provider);
}

#[test]
fn stale_grok_bridge_driver_cannot_override_a_newer_document_or_ready_state() {
    let unresolved = state_with("grok", "loaded", "unknown", "unknown", false);
    assert_eq!(
        grok_bridge_host_action(GrokBridgeDriveOutcome::Challenge, 4, 4, &unresolved),
        GrokBridgeHostAction::MarkBlocked
    );
    assert_eq!(
        grok_bridge_host_action(GrokBridgeDriveOutcome::Challenge, 3, 4, &unresolved),
        GrokBridgeHostAction::Ignore
    );
    assert_eq!(
        grok_bridge_host_action(GrokBridgeDriveOutcome::Waiting, 4, 4, &unresolved),
        GrokBridgeHostAction::Ignore
    );

    let mut ready = unresolved.clone();
    ready.dom = "ready".into();
    ready.login = "logged_in".into();
    assert_eq!(
        grok_bridge_host_action(GrokBridgeDriveOutcome::Challenge, 4, 4, &ready),
        GrokBridgeHostAction::Ignore
    );
}

#[test]
fn session_reset_accepts_only_a_new_document_boot() {
    assert!(!fresh_session_boot(Some("boot-a"), Some("boot-a")));
    assert!(fresh_session_boot(Some("boot-a"), Some("boot-b")));
    assert!(fresh_session_boot(None, Some("boot-a")));
    assert!(!fresh_session_boot(Some("boot-a"), None));
    assert!(!fresh_session_boot(None, None));
}

#[test]
fn grok_navigation_rejects_late_status_from_the_previous_document_boot() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.status_boot.remove(provider);
        guard.grok_adopted_boot.remove(provider);
        guard.grok_pending_navigation.remove(provider);
        guard.grok_document_epoch.remove(provider);
        guard.pending_session_boot.remove(provider);
    }

    let first_epoch = prepare_grok_navigation(provider).expect("first navigation reservation");
    assert_eq!(confirm_grok_page_load(provider), first_epoch);
    assert!(adopt_grok_bridge_boot(provider, first_epoch, "old-boot"));
    assert!(accept_status_for_session_reset(provider, Some("old-boot")));

    let next_epoch = prepare_grok_navigation(provider).expect("next navigation reservation");
    assert!(!grok_bridge_result_is_current(provider, first_epoch));
    assert!(!adopt_grok_bridge_boot(provider, first_epoch, "old-boot"));
    assert!(!accept_status_for_session_reset(provider, Some("old-boot")));
    assert_eq!(confirm_grok_page_load(provider), next_epoch);
    assert!(!grok_bridge_result_is_current(provider, first_epoch));
    assert!(!adopt_grok_bridge_boot(provider, first_epoch, "old-boot"));
    assert!(adopt_grok_bridge_boot(provider, next_epoch, "new-boot"));
    assert!(accept_status_for_session_reset(provider, Some("new-boot")));
    assert!(accept_status_for_session_reset(provider, Some("new-boot")));

    let restored_epoch =
        prepare_grok_navigation(provider).expect("restored navigation reservation");
    assert_eq!(confirm_grok_page_load(provider), restored_epoch);
    assert!(adopt_grok_bridge_boot(provider, restored_epoch, "old-boot"));
    assert!(accept_status_for_session_reset(provider, Some("old-boot")));

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.status_boot.remove(provider);
    guard.grok_adopted_boot.remove(provider);
    guard.grok_pending_navigation.remove(provider);
    guard.grok_document_epoch.remove(provider);
}

#[test]
fn failed_grok_navigation_restores_the_live_document_boot() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.status_boot.remove(provider);
        guard.grok_adopted_boot.remove(provider);
        guard.grok_pending_navigation.remove(provider);
        guard.grok_document_epoch.remove(provider);
        guard.pending_session_boot.remove(provider);
    }

    let live_epoch = prepare_grok_navigation(provider).expect("live navigation reservation");
    assert_eq!(confirm_grok_page_load(provider), live_epoch);
    assert!(adopt_grok_bridge_boot(provider, live_epoch, "live-boot"));
    assert!(accept_status_for_session_reset(provider, Some("live-boot")));

    let failed_epoch =
        prepare_grok_navigation(provider).expect("failed navigation reservation");
    assert!(!accept_status_for_session_reset(
        provider,
        Some("live-boot")
    ));
    cancel_grok_navigation(provider, failed_epoch);
    assert!(accept_status_for_session_reset(provider, Some("live-boot")));

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.status_boot.remove(provider);
    guard.grok_adopted_boot.remove(provider);
    guard.grok_pending_navigation.remove(provider);
    guard.grok_document_epoch.remove(provider);
}

#[test]
fn navigation_start_lease_reopens_manual_recovery_and_ignores_stale_tokens() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.grok_document_epoch.insert(provider.into(), 50);
        guard.grok_pending_navigation.remove(provider);
        guard
            .pending_session_boot
            .insert(provider.into(), Some("old-session".into()));
    }

    let timed_out = prepare_grok_navigation(provider).expect("timed-out lifecycle reservation");
    expire_grok_navigation_start_lease(provider, timed_out, GrokNavigationOwner::PopupClaimed);
    assert!(prepare_grok_navigation(provider).is_err());

    expire_grok_navigation_start_lease(provider, timed_out, GrokNavigationOwner::Lifecycle);
    {
        let guard = runtime().lock().expect("provider runtime lock");
        assert!(!guard.grok_pending_navigation.contains_key(provider));
        assert!(!guard.pending_session_boot.contains_key(provider));
    }

    let retry = prepare_grok_navigation(provider).expect("retry after lease expiry");
    assert_eq!(confirm_grok_page_load(provider), retry);
    let newer = prepare_grok_navigation(provider).expect("newer lifecycle reservation");
    expire_grok_navigation_start_lease(provider, retry, GrokNavigationOwner::Lifecycle);
    assert!(prepare_grok_navigation(provider).is_err());
    cancel_grok_navigation(provider, newer);

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.grok_document_epoch.remove(provider);
    guard.grok_pending_navigation.remove(provider);
    guard.pending_session_boot.remove(provider);
}

#[test]
fn delayed_external_auth_return_cannot_take_over_a_newer_grok_document() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.grok_document_epoch.insert(provider.into(), 70);
        guard.grok_pending_navigation.remove(provider);
    }

    assert!(prepare_grok_external_auth_return(provider, 69).is_none());
    let prepared = prepare_grok_external_auth_return(provider, 70)
        .expect("the current auth document may reserve one return");
    assert_eq!(prepared, 71);
    assert!(grok_external_auth_return_is_current(provider, 70, prepared));
    assert!(prepare_grok_external_auth_return(provider, 70).is_none());
    cancel_grok_navigation(provider, prepared);
    assert!(!grok_external_auth_return_is_current(
        provider, 70, prepared
    ));

    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.grok_document_epoch.insert(provider.into(), 72);
    }
    assert!(prepare_grok_external_auth_return(provider, 70).is_none());
    assert!(!grok_external_auth_return_is_current(
        provider, 70, prepared
    ));
    assert!(prepare_grok_external_auth_return("chatgpt", 72).is_none());
    assert!(prepare_grok_external_auth_return(provider, 0).is_none());

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.grok_document_epoch.remove(provider);
    guard.grok_pending_navigation.remove(provider);
}

#[test]
fn popup_recovery_reservation_is_single_owner_and_manual_navigation_supersedes_it() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.states.insert(
            provider.into(),
            state_with(provider, "loaded", "unknown", "blocked", false),
        );
        guard.grok_document_epoch.insert(provider.into(), 41);
        guard.grok_pending_navigation.remove(provider);
        guard.grok_adopted_boot.remove(provider);
        guard.status_boot.remove(provider);
    }

    assert!(prepare_grok_popup_recovery(provider, 40).is_none());
    let prepared = prepare_grok_popup_recovery(provider, 41)
        .expect("current blocked popup should recover");
    assert_eq!(prepared, 42);
    assert!(prepare_grok_popup_recovery(provider, 41).is_none());
    let manual = prepare_grok_navigation(provider)
        .expect("manual navigation should supersede an unclaimed popup recovery");
    assert_eq!(manual, prepared);
    assert!(!claim_grok_popup_recovery(provider, 41, prepared));
    assert!(prepare_grok_navigation(provider).is_err());
    cancel_grok_navigation(provider, manual);

    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.states.insert(
            provider.into(),
            state_with(provider, "loaded", "ready", "logged_in", false),
        );
    }
    assert!(prepare_grok_popup_recovery(provider, 41).is_none());

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.states.remove(provider);
    guard.grok_document_epoch.remove(provider);
    guard.grok_pending_navigation.remove(provider);
    guard.grok_adopted_boot.remove(provider);
    guard.status_boot.remove(provider);
}

#[test]
fn claimed_popup_recovery_rolls_back_on_failure_and_close_invalidates_it() {
    let _test_guard = GROK_RUNTIME_TEST_LOCK.lock().expect("Grok test lock");
    let provider = "grok";
    let mut previous_state = state_with(provider, "loaded", "unknown", "blocked", false);
    previous_state.bridge = "degraded".into();
    previous_state.bridge_reason = Some("previous bridge".into());
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.states.insert(provider.into(), previous_state.clone());
        guard.grok_document_epoch.insert(provider.into(), 41);
        guard
            .grok_adopted_boot
            .insert(provider.into(), (41, "old-adopted".into()));
        guard
            .status_boot
            .insert(provider.into(), "old-status".into());
        guard
            .engine_boot
            .insert(provider.into(), "old-engine".into());
        guard
            .bridge_boot
            .insert(provider.into(), "old-bridge".into());
        guard.last_push_ms.insert(provider.into(), 71);
        guard.stale_check_sent.insert(provider.into(), 72);
        guard.grok_pending_navigation.remove(provider);
    }

    let prepared = prepare_grok_popup_recovery(provider, 41)
        .expect("current blocked popup should reserve recovery");
    assert!(claim_grok_popup_recovery(provider, 41, prepared));
    assert!(grok_popup_recovery_claim_is_current(provider, prepared));
    assert!(prepare_grok_navigation(provider).is_err());
    {
        let guard = runtime().lock().expect("provider runtime lock");
        assert!(!provider_document_allows_generic_eval(
            provider,
            true,
            guard.states.get(provider),
            41,
            Some(41),
            Some(41),
            guard.grok_pending_navigation.contains_key(provider),
        ));
    }

    // Reload enqueue can succeed without a Started event. Lease expiry must restore the live
    // blocked document's full runtime snapshot and reopen manual recovery.
    expire_grok_navigation_start_lease(provider, prepared, GrokNavigationOwner::PopupClaimed);
    {
        let guard = runtime().lock().expect("provider runtime lock");
        assert_eq!(guard.states.get(provider), Some(&previous_state));
        assert_eq!(
            guard.grok_adopted_boot.get(provider),
            Some(&(41, "old-adopted".into()))
        );
        assert_eq!(
            guard.status_boot.get(provider).map(String::as_str),
            Some("old-status")
        );
        assert_eq!(
            guard.engine_boot.get(provider).map(String::as_str),
            Some("old-engine")
        );
        assert_eq!(
            guard.bridge_boot.get(provider).map(String::as_str),
            Some("old-bridge")
        );
        assert_eq!(guard.last_push_ms.get(provider), Some(&71));
        assert_eq!(guard.stale_check_sent.get(provider), Some(&72));
        assert!(!guard.grok_pending_navigation.contains_key(provider));
    }

    // Closing the provider retires the claimed token before any delayed reload can run.
    let close_prepared =
        prepare_grok_popup_recovery(provider, 41).expect("second popup recovery reservation");
    assert!(claim_grok_popup_recovery(provider, 41, close_prepared));
    retire_grok_document(provider);
    assert!(!grok_popup_recovery_claim_is_current(
        provider,
        close_prepared
    ));
    cancel_grok_popup_recovery(provider, close_prepared);

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.states.remove(provider);
    guard.engine_boot.remove(provider);
    guard.bridge_boot.remove(provider);
    guard.status_boot.remove(provider);
    guard.grok_document_epoch.remove(provider);
    guard.grok_app_title_epoch.remove(provider);
    guard.grok_adopted_boot.remove(provider);
    guard.grok_pending_navigation.remove(provider);
    guard.last_push_ms.remove(provider);
    guard.stale_check_sent.remove(provider);
}

#[test]
fn session_reset_parses_native_and_wrapped_eval_booleans() {
    assert!(eval_callback_reports_true("true"));
    assert!(eval_callback_reports_true(r#""true""#));
    assert!(!eval_callback_reports_true("false"));
    assert!(!eval_callback_reports_true(r#""false""#));
    assert!(!eval_callback_reports_true("null"));
}

#[test]
fn cancelled_session_reset_accepts_status_from_the_current_document_again() {
    let provider = "test-cancelled-session-reset";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.status_boot.insert(provider.into(), "boot-a".into());
        guard
            .pending_session_boot
            .insert(provider.into(), Some("boot-a".into()));
    }

    assert!(!accept_status_for_session_reset(provider, Some("boot-a")));
    cancel_session_reset(provider);
    assert!(accept_status_for_session_reset(provider, Some("boot-a")));

    let mut guard = runtime().lock().expect("provider runtime lock");
    guard.status_boot.remove(provider);
    guard.pending_session_boot.remove(provider);
}

#[test]
fn degraded_bridge_reset_uses_bridge_boot_reference() {
    let provider = "test-bridge-boot-reference";
    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        let mut state = state_with(provider, "loaded", "ready", "logged_in", false);
        state.bridge = "degraded".into();
        guard.states.insert(provider.into(), state);
        guard.engine_boot.remove(provider);
        guard.bridge_boot.insert(provider.into(), "boot-b".into());
    }

    assert!(!should_reset_bridge_on_boot_rotation(
        provider,
        Some("boot-b")
    ));
    assert!(should_reset_bridge_on_boot_rotation(
        provider,
        Some("boot-c")
    ));

    {
        let mut guard = runtime().lock().expect("provider runtime lock");
        guard.states.remove(provider);
        guard.bridge_boot.remove(provider);
        guard.engine_boot.remove(provider);
        guard.status_boot.remove(provider);
        guard.pending_session_boot.remove(provider);
    }
}
