mod data_root;
mod engine;
mod firefox;
mod fonts;
mod platform;
mod profile_commands;
mod profiles;
mod proxy;

#[tauri::command]
fn is_portable_build() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        Ok(!exe
            .parent()
            .is_some_and(|folder| folder.join("uninstall.exe").is_file()))
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
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
async fn scan_environment(
    app: tauri::AppHandle,
    browser: String,
    profile_id: Option<String>,
) -> Result<engine::Scan, String> {
    let (mut local, upstream) = tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        let root = &app.state::<data_root::DataRoot>().0;
        let scoped = profiles::context(root, &browser, profile_id.as_deref())?;
        let scan = engine::scan_local(&scoped, &browser)?;
        let upstream = if let Some(id) = profile_id {
            let p = profiles::get(root, &id, false)?;
            Some(profiles::upstream(&p, profiles::running(root, &p)?)?)
        } else {
            None
        };
        Ok::<_, String>((scan, upstream))
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Some(upstream) = upstream {
        let result = proxy::test(upstream).await;
        match result {
            Ok(test) => {
                local.ip = test.ip;
                local.location = test.country;
                local.latency = Some(test.latency);
                for c in &mut local.checks {
                    if c.id == "connection" {
                        c.value = test.target.clone();
                        c.status = "manual".into();
                        c.detail =
                            "通过当前副本代理路径检测；HTTP 状态和实际浏览器结果需分别确认".into();
                    }
                    if c.id == "route" {
                        c.value = local.ip.clone().unwrap_or_else(|| "未读取到出口 IP".into());
                        c.detail = test.connection.clone();
                    }
                }
            }
            Err(message) => {
                local.ip = None;
                local.location = None;
                local.latency = None;
                for c in &mut local.checks {
                    if ["connection", "route"].contains(&c.id.as_str()) {
                        c.status = "warning".into();
                        c.value = "副本网络检测失败".into();
                        c.detail = message.clone();
                    }
                }
            }
        }
        Ok(local)
    } else {
        Ok(engine::scan_network(local).await)
    }
}

#[tauri::command]
async fn check_repair_readiness(
    app: tauri::AppHandle,
    browser: String,
    ids: Vec<String>,
    profile_id: Option<String>,
) -> Result<engine::Readiness, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        let root = &app.state::<data_root::DataRoot>().0;
        if ids.iter().any(|id| id == "timezone") {
            if let Err(message) = profiles::ensure_all_closed(root) {
                return Ok(engine::Readiness {
                    ready: false,
                    message,
                });
            }
        }
        engine::repair_readiness(
            &profiles::context(root, &browser, profile_id.as_deref())?,
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
        .await
        .map_err(|e| e.to_string())?
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
        profiles::ensure_all_closed(&app.state::<data_root::DataRoot>().0)?;
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
    profile_id: Option<String>,
) -> Result<Vec<engine::Outcome>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        let root = &app.state::<data_root::DataRoot>().0;
        if ids.iter().any(|id| id == "timezone") {
            profiles::ensure_all_closed(root)?;
        }
        let scoped = profiles::context(root, &browser, profile_id.as_deref())?;
        let local: Vec<_> = ids
            .iter()
            .filter(|id| !["timezone", "cli"].contains(&id.as_str()))
            .cloned()
            .collect();
        let global: Vec<_> = ids
            .iter()
            .filter(|id| ["timezone", "cli"].contains(&id.as_str()))
            .cloned()
            .collect();
        let mut output = vec![];
        if !local.is_empty() {
            if let Some(id) = profile_id.as_deref() {
                profiles::apply_pending_preferences(root, id)?;
            }
            output.extend(engine::repair_with_font_consent(
                &scoped,
                &browser,
                &local,
                consent_timezone,
                timezone_target.as_deref().unwrap_or("singapore"),
                consent_fonts.unwrap_or(false),
            )?);
        }
        if let Some(id) = profile_id.as_deref() {
            if output.iter().any(|o| o.success) {
                profiles::sync_preferences(root, id)?;
            }
        }
        if !global.is_empty() {
            output.extend(engine::repair_with_font_consent(
                root,
                &browser,
                &global,
                consent_timezone,
                timezone_target.as_deref().unwrap_or("singapore"),
                consent_fonts.unwrap_or(false),
            )?);
        }
        Ok(output)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_history(
    app: tauri::AppHandle,
    lock: State<OperationLock>,
    profile_id: Option<String>,
) -> Result<Vec<engine::Record>, String> {
    let _lock = lock.0.lock().map_err(|_| "操作锁不可用".to_string())?;
    profiles::history(&app.state::<data_root::DataRoot>().0, profile_id.as_deref())
}

#[tauri::command]
async fn undo_repair(
    app: tauri::AppHandle,
    record_id: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        let root = &app.state::<data_root::DataRoot>().0;
        let records = profiles::history(root, None)?;
        let record = records
            .iter()
            .find(|r| r.id == record_id && r.profile_id == profile_id)
            .ok_or("修复记录与副本不匹配")?;
        if record.profile_id.is_none() {
            profiles::ensure_all_closed(root)?;
        }
        if let Some(id) = profile_id.as_deref() {
            profiles::apply_pending_preferences(root, id)?;
        }
        engine::undo(
            &profiles::context(root, &record.browser, profile_id.as_deref())?,
            &record_id,
        )?;
        if let Some(id) = profile_id {
            profiles::sync_preferences(root, &id)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn launch_browser(
    app: tauri::AppHandle,
    browser: String,
    destination: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用".to_string())?;
        if let Some(id) = profile_id {
            let p = profiles::get(&app.state::<data_root::DataRoot>().0, &id, false)?;
            if p.browser != browser {
                return Err("副本浏览器类型不匹配".into());
            }
            return profile_commands::launch(
                &app.state::<data_root::DataRoot>().0,
                &id,
                &destination,
                &app.state::<profiles::Runtime>(),
            );
        }
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
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(OperationLock::default())
        .manage(profiles::Runtime::default())
        .setup(|app| {
            let root = data_root::resolve(app.path().app_data_dir()?);
            profiles::load(&root)?;
            app.manage(data_root::DataRoot(root.clone()));
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let guard = handle.state::<OperationLock>();
                if let Ok(_lock) = guard.0.lock() {
                    if let Ok(list) = profiles::load(&root) {
                        for p in list {
                            if p.deleted_at.is_none()
                                && profiles::running(&root, &p).unwrap_or(false)
                            {
                                let _ = tauri::async_runtime::block_on(profiles::prepare_relay(
                                    &root,
                                    &p,
                                    &handle.state::<profiles::Runtime>(),
                                    true,
                                ));
                            }
                        }
                    }
                };
            });
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let show = MenuItem::with_id(app, "show", "打开 Claude Done", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出…", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Claude Done · 浏览器副本与代理保持运行")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        if event.id.as_ref() == "quit" {
                            use tauri::Emitter;
                            let _ = app.emit("request-quit", ());
                        }
                    }
                })
                .build(app)?;
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
            launch_cli,
            profile_commands::list_profiles,
            profile_commands::save_profile,
            profile_commands::delete_profile,
            profile_commands::restore_profile,
            profile_commands::test_profile_proxy,
            profile_commands::start_profile,
            profile_commands::close_profile,
            profile_commands::restart_profile,
            profile_commands::prepare_application_update,
            profile_commands::quit_application
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to start Claude Done")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    use tauri::Emitter;
                    let _ = app.emit("request-quit", ());
                }
            }
        });
}
