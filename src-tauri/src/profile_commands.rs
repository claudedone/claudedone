use crate::{
    data_root, engine, platform,
    profiles::{self, Draft, Profile, ProfileView, Runtime},
    proxy::{self, ProxyTest},
    OperationLock,
};
use std::path::Path;
use tauri::Manager;

async fn operation<T: Send + 'static>(
    app: tauri::AppHandle,
    action: impl FnOnce(&Path, &Runtime) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<OperationLock>();
        let _lock = guard.0.lock().map_err(|_| "操作锁不可用")?;
        action(
            &app.state::<data_root::DataRoot>().0,
            &app.state::<Runtime>(),
        )
    })
    .await
    .map_err(|_| "副本操作未完成")?
}
#[tauri::command]
pub async fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ProfileView>, String> {
    operation(app, |root, runtime| profiles::views(root, runtime)).await
}
#[tauri::command]
pub async fn save_profile(
    app: tauri::AppHandle,
    id: Option<String>,
    draft: Draft,
    copy_id: Option<String>,
) -> Result<Profile, String> {
    operation(app, move |root, _| {
        if let Some(id) = id {
            profiles::update(root, &id, draft)
        } else {
            profiles::create(root, draft, copy_id.as_deref())
        }
    })
    .await
}
#[tauri::command]
pub async fn delete_profile(app: tauri::AppHandle, id: String, purge: bool) -> Result<(), String> {
    operation(app, move |root, runtime| {
        profiles::remove(root, &id, purge, runtime)
    })
    .await
}
#[tauri::command]
pub async fn restore_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    operation(app, move |root, _| profiles::restore(root, &id)).await
}
#[tauri::command]
pub async fn test_profile_proxy(
    app: tauri::AppHandle,
    id: Option<String>,
    draft: Option<Draft>,
) -> Result<ProxyTest, String> {
    operation(app, move |root, _| {
        let up = if let Some(draft) = &draft {
            profiles::draft_upstream(root, id.as_deref(), draft)?
        } else {
            let p = profiles::get(root, id.as_deref().ok_or("请选择副本")?, false)?;
            profiles::upstream(&p, profiles::running(root, &p)?)?
        };
        let result = tauri::async_runtime::block_on(proxy::test(up))?;
        if draft.is_none() {
            if let Some(id) = &id {
                let p = profiles::get(root, id, false)?;
                if p.active_proxy
                    .as_ref()
                    .is_none_or(|active| active == &p.proxy)
                {
                    profiles::remember_test(root, id, result.clone())?;
                }
            }
        }
        Ok(result)
    })
    .await
}
pub fn launch(root: &Path, id: &str, destination: &str, runtime: &Runtime) -> Result<(), String> {
    let p = profiles::get(root, id, false)?;
    let path = profiles::path(root, &p)?;
    if profiles::running(root, &p)? {
        if destination == "startup" || destination == "focus" {
            return platform::focus_profile(&path);
        }
        if p.browser == "firefox" {
            return Err("此 Firefox 副本正在运行。请先关闭再打开检测页，或在该窗口访问 https://claudedone.com/check/。".into());
        }
        let port =
            tauri::async_runtime::block_on(profiles::prepare_relay(root, &p, runtime, true))?;
        let url = destination_url(root, &p, destination)?;
        return platform::spawn_browser_with_proxy(
            &p.browser,
            &path,
            &url,
            &p.active_proxy.as_ref().unwrap_or(&p.proxy).mode,
            port,
        );
    }
    profiles::apply_preferences(root, &p)?;
    let port = tauri::async_runtime::block_on(profiles::prepare_relay(root, &p, runtime, false))?;
    let url = destination_url(root, &p, destination)?;
    profiles::mark_started(root, id, port)?;
    if let Err(error) =
        platform::spawn_browser_with_proxy(&p.browser, &path, &url, &p.proxy.mode, port)
    {
        runtime.0.lock().map_err(|_| "代理管理器不可用")?.remove(id);
        return Err(error);
    }
    Ok(())
}
fn destination_url(root: &Path, p: &Profile, destination: &str) -> Result<String, String> {
    Ok(match destination {
        "startup" => p.preferences.startup_url.clone(),
        "claude" => "https://claude.ai".into(),
        "verify" => format!(
            "https://claudedone.com/check/?profile={}&browser={}",
            p.id, p.browser
        ),
        "dns" => {
            if p.browser == "firefox" {
                "about:preferences#privacy".into()
            } else {
                "chrome://settings/security".into()
            }
        }
        "privacyDocs" => "https://code.claude.com/docs/en/data-usage".into(),
        "diagnostics" => {
            let file = profiles::path(root, p)?.join("browser-check.html");
            let page = include_str!("../resources/browser-check.html")
                .replace("__CLAUDE_READY_BROWSER__", &p.browser)
                .replace("__CLAUDE_DONE_PROFILE__", &p.id);
            engine::atomic_write(&file, page.as_bytes())?;
            reqwest::Url::from_file_path(file)
                .map_err(|_| "检测页路径无效")?
                .to_string()
        }
        _ => return Err("不支持的启动页面".into()),
    })
}
#[tauri::command]
pub async fn start_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    operation(app, move |root, runtime| {
        launch(root, &id, "startup", runtime)
    })
    .await
}
#[tauri::command]
pub async fn close_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    operation(app, move |root, runtime| {
        let p = profiles::get(root, &id, false)?;
        platform::close_profile(&profiles::path(root, &p)?)?;
        runtime
            .0
            .lock()
            .map_err(|_| "代理管理器不可用")?
            .remove(&id);
        profiles::views(root, runtime)?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn restart_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    operation(app, move |root, runtime| {
        let p = profiles::get(root, &id, false)?;
        platform::close_profile(&profiles::path(root, &p)?)?;
        runtime
            .0
            .lock()
            .map_err(|_| "代理管理器不可用")?
            .remove(&id);
        launch(root, &id, "startup", runtime)
    })
    .await
}
#[tauri::command]
pub async fn prepare_application_update(app: tauri::AppHandle) -> Result<(), String> {
    operation(app, |root, runtime| {
        for p in profiles::views(root, runtime)?
            .into_iter()
            .filter(|p| p.running)
        {
            platform::close_profile(&profiles::path(root, &p.profile)?)?;
        }
        runtime.0.lock().map_err(|_| "代理管理器不可用")?.clear();
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn quit_application(app: tauri::AppHandle, close_profiles: bool) -> Result<(), String> {
    let closing = app.clone();
    operation(app, move |root, runtime| {
        let active = profiles::views(root, runtime)?
            .into_iter()
            .filter(|p| p.running)
            .collect::<Vec<_>>();
        if !active.is_empty() && !close_profiles {
            return Err("仍有浏览器副本运行，请选择关闭副本后退出，或继续后台运行。".into());
        }
        for p in active {
            platform::close_profile(&profiles::path(root, &p.profile)?)?;
        }
        runtime.0.lock().map_err(|_| "代理管理器不可用")?.clear();
        Ok(())
    })
    .await?;
    closing.exit(0);
    Ok(())
}
