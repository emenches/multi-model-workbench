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
const TOOLBAR_LOGICAL_HEIGHT: f64 = 48.0;
const DEFAULT_WEBMAIL: &str = "https://mail.google.com/";

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

fn send_magic_link_to_claude(app: AppHandle, url: tauri::Url) {
    if !is_claude_link(&url) { return; }
    // Do not log, serialize, emit or store the URL: it may contain a login
    // token. Schedule outside the WKNavigationDelegate callback so WebKit
    // never navigates reentrantly during its own policy decision.
    tauri::async_runtime::spawn(async move {
        let _ = app.run_on_main_thread(move || {
            if let Some(claude) = app.get_webview(CLAUDE_LABEL) {
                if claude.navigate(url).is_ok() {
                    let _ = show_claude(&app);
                }
            }
        });
    });
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
                    send_magic_link_to_claude(nav_app.clone(), target.clone());
                    return false;
                }
                // Email pages may use SSO. No arbitrary local protocols.
                target.scheme() == "https" || target.scheme() == "about"
            })
            .on_new_window(move |target, _features| {
                if is_claude_link(&target) {
                    send_magic_link_to_claude(popup_app.clone(), target);
                } else if target.scheme() == "https" {
                    // Keep user-initiated links inside the email tab. This
                    // may not support SSO flows requiring a true popup; that
                    // case must be tested separately on macOS.
                    if let Some(mail) = popup_app.get_webview(MAIL_LABEL) {
                        let _ = mail.navigate(target);
                    }
                }
                NewWindowResponse::Deny
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
    use super::{is_claude_link, safe_webmail_url};

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
