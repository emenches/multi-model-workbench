mod adapters;
mod claude_login_tabs;
mod bridge;
mod projects;
mod session_checkpoint;
mod settings;
mod snapshots;
mod webviews;

use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, Submenu};

/// A native menu escape works even when a provider's WebView obscures React.
const RETURN_TO_WORKBENCH: &str = "return-to-workbench";
const MINIMIZE_PROVIDER_PAGE: &str = "minimize-provider-page";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProviderMenuAction {
    Minimize,
    ReturnAndCloseLogin,
}

fn provider_menu_action(id: &str) -> Option<ProviderMenuAction> {
    match id {
        MINIMIZE_PROVIDER_PAGE => Some(ProviderMenuAction::Minimize),
        RETURN_TO_WORKBENCH => Some(ProviderMenuAction::ReturnAndCloseLogin),
        _ => None,
    }
}

/// A provider login window can be visible while the primary workbench is not.
/// Never use Cocoa's global has_visible_windows bit to decide whether clicking
/// Cogitor's Dock icon should restore the actual app.
#[cfg(any(test, target_os = "macos"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MainWindowRecovery {
    ShowExisting,
    RecreateFromConfig,
}

#[cfg(any(test, target_os = "macos"))]
fn main_window_recovery(main_window_exists: bool, _has_visible_windows: bool) -> MainWindowRecovery {
    if main_window_exists {
        MainWindowRecovery::ShowExisting
    } else {
        MainWindowRecovery::RecreateFromConfig
    }
}

#[cfg(target_os = "macos")]
fn show_and_focus_main_window(app: &tauri::AppHandle, has_visible_windows: bool) -> Result<(), String> {
    // A red-button close may have destroyed the control WebView in older
    // builds, leaving hidden provider windows alive. Rebuild only the missing
    // control window; never reload or discard authenticated provider profiles.
    let existing = app.get_webview_window("main");
    let main = match main_window_recovery(existing.is_some(), has_visible_windows) {
        MainWindowRecovery::ShowExisting => existing.expect("existing main window was checked"),
        MainWindowRecovery::RecreateFromConfig => {
            let main_config = app.config().app.windows.iter()
                .find(|config| config.label == "main")
                .ok_or_else(|| "main window configuration is missing".to_string())?;
            tauri::WebviewWindowBuilder::from_config(app, main_config)
                .map_err(|error| error.to_string())?
                .build()
                .map_err(|error| error.to_string())?
        }
    };
    // A minimized or hidden main window does not become visible just because
    // macOS activates the process in the Dock.
    main.unminimize().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    let _ = app.emit_to("main", "workbench://return", ());
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The feature-frozen edition intentionally uses GitHub Releases instead of a self-updater.
        .setup(|app| {
            // Preserve default Quit/Edit/Window menus, and add an OS-level login escape.
            let menu = Menu::default(app.handle())?;
            let minimize = MenuItem::with_id(app.handle(), MINIMIZE_PROVIDER_PAGE,
                "Minimize Provider Page", true, Some("CmdOrCtrl+Shift+M"))?;
            let escape = MenuItem::with_id(app.handle(), RETURN_TO_WORKBENCH,
                "Return to Cogitor (Close Login)", true, Some("CmdOrCtrl+Shift+0"))?;
            menu.append(&Submenu::with_items(
                app.handle(), "Cogitor", true, &[&minimize, &escape],
            )?)?;
            app.set_menu(menu)?;
            // Remote selector checks are opt-in. The native adapter refresh rejects
            // network access and restores bundled selectors while disabled.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                adapters::refresh_all_adapters(handle.clone(), false).await;
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
                interval.tick().await; // consume the immediate first tick (startup run already done)
                loop {
                    interval.tick().await;
                    adapters::refresh_all_adapters(handle.clone(), false).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Keep the React transcript and native provider sessions
                    // alive on the red close button. Cmd+Q still terminates
                    // the app normally; the Dock icon restores this window.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .on_menu_event(|app, event| {
            let Some(action) = provider_menu_action(event.id().0.as_str()) else {
                return;
            };
            // Native recovery must succeed even if the local control pane is covered.
            for provider in ["chatgpt", "claude", "gemini", "grok", "meta"] {
                if let Some(webview) = app.get_webview(&format!("ai-{provider}")) {
                    let _ = webview.hide();
                }
                if let Some(window) = app.get_window(&format!("provider-page-{provider}")) {
                    let _ = window.hide();
                }
            }
            // Minimize is non-destructive: it never closes OAuth popups or
            // resets login sessions. The separate emergency return action does.
            if action == ProviderMenuAction::ReturnAndCloseLogin {
                for (label, window) in app.webview_windows() {
                    if label.starts_with("provider-popup-") {
                        let _ = window.close();
                    }
                }
            }
            if let Some(main) = app.get_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            let _ = app.emit_to("main", "workbench://return", ());
        })
        .invoke_handler(tauri::generate_handler![
            claude_login_tabs::claude_auth_tab_open_email,
            claude_login_tabs::claude_auth_tab_switch,
            claude_login_tabs::claude_auth_tab_close_email,
            webviews::provider_open,
            webviews::provider_open_window,
            webviews::provider_close,
            webviews::provider_show,
            webviews::provider_hide,
            webviews::provider_set_bounds,
            webviews::provider_control_action,
            webviews::provider_bridge_read,
            webviews::provider_open_login,
            webviews::provider_open_login_external,
            webviews::provider_reload,
            webviews::provider_new_session,
            webviews::connections_get,
            webviews::dev_log,
            adapters::adapter_push,
            adapters::report_broken,
            adapters::open_adapter_issue,
            projects::projects_load,
            projects::projects_save,
            settings::settings_get,
            settings::settings_set,
            settings::export_markdown,
            settings::open_external_url,
            snapshots::snapshot_save,
            snapshots::snapshot_list,
            snapshots::snapshot_load,
            snapshots::snapshot_delete,
            session_checkpoint::session_checkpoint_save,
            session_checkpoint::session_checkpoint_load,
            session_checkpoint::session_checkpoint_clear
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if let Err(error) = show_and_focus_main_window(app, has_visible_windows) {
                    eprintln!("[cogitor-window] Dock reopen failed: {error}");
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod provider_menu_tests {
    use super::*;

    #[test]
    fn normal_minimize_keeps_login_popups_open() {
        assert_eq!(provider_menu_action(MINIMIZE_PROVIDER_PAGE), Some(ProviderMenuAction::Minimize));
        assert_ne!(provider_menu_action(MINIMIZE_PROVIDER_PAGE), Some(ProviderMenuAction::ReturnAndCloseLogin));
    }

    #[test]
    fn emergency_return_closes_transient_logins() {
        assert_eq!(provider_menu_action(RETURN_TO_WORKBENCH), Some(ProviderMenuAction::ReturnAndCloseLogin));
        assert_eq!(provider_menu_action("unrelated-menu-item"), None);
    }

    #[test]
    fn dock_reopen_restores_main_even_if_a_provider_window_is_visible() {
        assert_eq!(main_window_recovery(true, true), MainWindowRecovery::ShowExisting);
        assert_eq!(main_window_recovery(true, false), MainWindowRecovery::ShowExisting);
    }

    #[test]
    fn dock_reopen_recreates_missing_main_regardless_of_other_visible_windows() {
        assert_eq!(main_window_recovery(false, true), MainWindowRecovery::RecreateFromConfig);
        assert_eq!(main_window_recovery(false, false), MainWindowRecovery::RecreateFromConfig);
    }
}
