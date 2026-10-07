mod data_root;
mod engine;
mod firefox;
mod fonts;
mod platform;

#[tauri::command]
fn is_portable_build() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        Ok(!exe.parent().is_some_and(|folder| folder.join("uninstall.exe").is_file()))
    }
    #[cfg(not(windows))]
    { Ok(false) }
}

#[tauri::command]
fn open_telegram_group() -> Result<(), String> {
    platform::open_telegram_group()
}

#[tauri::command]
fn open_download_page() -> Result<(), String> {
    platform::open_download_page()
}

#[tauri::command]
fn open_firefox_download() -> Result<(), String> {
    platform::open_firefox_download()
}

use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
struct OperationLock(Mutex<()>);

#[tauri::command]
async fn scan_environment(app: tauri::AppHandle, browser: String) -> Result<engine::Scan, String> {
    let local = tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::scan_local(
            &app.state::<data_root::DataRoot>().0,
            &browser,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(engine::scan_network(local).await)
}

#[tauri::command]
async fn check_repair_readiness(
    app: tauri::AppHandle,
    browser: String,
    ids: Vec<String>,
) -> Result<engine::Readiness, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::repair_readiness(
            &app.state::<data_root::DataRoot>().0,
            &browser,
            &ids,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_timezone_settings() -> Result<(), String> {
    platform::open_timezone_settings()
}

#[tauri::command]
async fn get_timezone_catalog() -> Result<Vec<platform::TimezoneOption>, String> {
    tauri::async_runtime::spawn_blocking(platform::timezone_catalog)
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_font_catalog() -> Result<fonts::Catalog, String> {
    tauri::async_runtime::spawn_blocking(fonts::catalog)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn remove_user_fonts(
    app: tauri::AppHandle,
    browser: String,
    ids: Vec<String>,
    consent: bool,
) -> Result<Vec<fonts::FontOutcome>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::remove_user_fonts(
            &app.state::<data_root::DataRoot>().0,
            &browser,
            &ids,
            consent,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn repair_environment(
    app: tauri::AppHandle,
    browser: String,
    ids: Vec<String>,
    consent_timezone: bool,
    timezone_target: Option<String>,
    consent_fonts: Option<bool>,
) -> Result<Vec<engine::Outcome>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::repair_with_font_consent(
            &app.state::<data_root::DataRoot>().0,
            &browser,
            &ids,
            consent_timezone,
            timezone_target.as_deref().unwrap_or("singapore"),
            consent_fonts.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_history(
    app: tauri::AppHandle,
    lock: State<OperationLock>,
) -> Result<Vec<engine::Record>, String> {
    let _lock = lock.0.lock().map_err(|_| "操作锁不可用".to_string())?;
    engine::history(&app.state::<data_root::DataRoot>().0)
}

#[tauri::command]
async fn undo_repair(app: tauri::AppHandle, record_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::undo(
            &app.state::<data_root::DataRoot>().0,
            &record_id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn launch_browser(
    app: tauri::AppHandle,
    browser: String,
    destination: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::launch_browser(
            &app.state::<data_root::DataRoot>().0,
            &browser,
            &destination,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn launch_cli(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        engine::launch_cli(&app.state::<data_root::DataRoot>().0)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(OperationLock::default())
        .setup(|app| {
            app.manage(data_root::DataRoot(data_root::resolve(app.path().app_data_dir()?)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_environment,
            check_repair_readiness,
            open_timezone_settings,
            get_timezone_catalog,
            open_telegram_group,
            is_portable_build,
            open_download_page,
            open_firefox_download,
            get_font_catalog,
            remove_user_fonts,
            repair_environment,
            get_history,
            undo_repair,
            launch_browser,
            launch_cli
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start Claude Done");
}
