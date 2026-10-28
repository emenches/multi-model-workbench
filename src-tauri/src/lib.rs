mod adapters;
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
                "Return to Workbench (Close Login)", true, Some("CmdOrCtrl+Shift+0"))?;
            menu.append(&Submenu::with_items(
                app.handle(), "Workbench", true, &[&minimize, &escape],
            )?)?;
            app.set_menu(menu)?;
            // SPEC §5 hot-update: refresh adapters at startup and every 6h (best-effort, off the UI thread).
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
            webviews::provider_open,
            webviews::provider_open_window,
            webviews::provider_close,
            webviews::provider_show,
            webviews::provider_hide,
            webviews::provider_set_bounds,
            webviews::provider_eval,
            webviews::provider_eval_with_callback,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
}
