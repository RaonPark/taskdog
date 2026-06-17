#[cfg(windows)]
mod appid;
mod devstatus;
mod gitlab;
mod jira;
mod secrets;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "main-tray";
const MAIN_WINDOW: &str = "main";

/// 트레이 툴팁에 미해결 건수 표시.
#[tauri::command]
fn set_badge(app: AppHandle, count: i64) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("TaskDog · 미해결 {count}건")));
    }
    Ok(())
}

/// 마감 알림 토스트. Windows에선 우리 AUMID("TaskDog")로 직접 발송하고
/// (플러그인은 설치본에서만 AUMID를 붙여 dev/target 실행 시 PowerShell로 폴백되므로),
/// macOS/Linux에선 이미 등록된 tauri-plugin-notification으로 발송한다.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = &app;
        appid::show_toast(&title, &body)
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| e.to_string())
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

fn focus_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            jira::fetch_issues,
            gitlab::fetch_gitlab_mr,
            gitlab::search_project_mrs,
            devstatus::fetch_dev_mrs,
            secrets::save_token,
            secrets::has_token,
            secrets::delete_token,
            secrets::save_gitlab_token,
            secrets::has_gitlab_token,
            secrets::delete_gitlab_token,
            set_badge,
            notify
        ])
        .setup(|app| {
            // Windows 토스트 알림 출처 이름을 "TaskDog"으로 표시(설치본에서 적용).
            #[cfg(windows)]
            appid::register(app.handle());

            let show_i = MenuItem::with_id(app, "show", "열기/숨기기", true, None::<&str>)?;
            let refresh_i = MenuItem::with_id(app, "refresh", "새로고침", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "설정", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &refresh_i, &settings_i, &quit_i])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("TaskDog")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_window(app),
                    "refresh" => {
                        let _ = app.emit("tray://refresh", ());
                        focus_window(app);
                    }
                    "settings" => {
                        let _ = app.emit("tray://settings", ());
                        focus_window(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
