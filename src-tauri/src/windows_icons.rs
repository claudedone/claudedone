//! Transparent shell icons follow the taskbar theme, not AppsUseLightTheme or
//! the webview's appearance override. Windows supports those independently.
use tauri::{image::Image, Manager, Theme};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
    System::{
        Registry::{RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET},
        Threading::{CreateEventW, WaitForSingleObject, INFINITE},
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
pub const TRAY_ID: &str = "nodecloak-tray";

fn theme_from_registry(value: Option<u32>) -> Theme {
    if value == Some(1) {
        Theme::Light
    } else {
        Theme::Dark
    }
}

fn shell_theme() -> Theme {
    let value = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(PERSONALIZE)
        .and_then(|key| key.get_value::<u32, _>("SystemUsesLightTheme"))
        .ok();
    theme_from_registry(value)
}

fn image(theme: Theme, tray: bool) -> Image<'static> {
    let (bytes, size): (&'static [u8], u32) = match (theme, tray) {
        (Theme::Light, true) => (include_bytes!("../icons/windows/on-light-32.rgba"), 32),
        (Theme::Light, false) => (include_bytes!("../icons/windows/on-light-128.rgba"), 128),
        (_, true) => (include_bytes!("../icons/windows/on-dark-32.rgba"), 32),
        (_, false) => (include_bytes!("../icons/windows/on-dark-128.rgba"), 128),
    };
    Image::new(bytes, size, size)
}

pub fn initial_tray_icon() -> Image<'static> {
    image(shell_theme(), true)
}

fn refresh(app: &tauri::AppHandle, previous: &mut Option<Theme>) {
    let theme = shell_theme();
    if *previous == Some(theme) {
        return;
    }
    let mut succeeded = true;
    for window in app.webview_windows().values() {
        succeeded &= window.set_icon(image(theme, false)).is_ok();
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        succeeded &= tray.set_icon(Some(image(theme, true))).is_ok();
    }
    // Retry on a later notification if a UI dispatch failed.
    if succeeded {
        *previous = Some(theme);
    }
}

struct Watcher {
    key: Option<RegKey>,
    event: HANDLE,
}
impl Watcher {
    fn new() -> Option<Self> {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(PERSONALIZE)
            .ok()?;
        // SAFETY: null security/name pointers are supported; event is auto-reset.
        let event = unsafe { CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) };
        if event.is_null() {
            None
        } else {
            Some(Self {
                key: Some(key),
                event,
            })
        }
    }

    fn arm(&self) -> bool {
        // SAFETY: the owned registry key and event remain alive during the wait.
        let Some(key) = self.key.as_ref() else {
            return false;
        };
        unsafe {
            RegNotifyChangeKeyValue(
                key.raw_handle(),
                0,
                REG_NOTIFY_CHANGE_LAST_SET,
                self.event,
                1,
            ) == 0
        }
    }

    fn wait(&self) -> bool {
        // SAFETY: event is a valid owned handle; this blocks only the watcher thread.
        unsafe { WaitForSingleObject(self.event, INFINITE) == WAIT_OBJECT_0 }
    }
}
impl Drop for Watcher {
    fn drop(&mut self) {
        // End the registration before closing the event to avoid a stale target.
        drop(self.key.take());
        // SAFETY: event was created by CreateEventW and has not been closed.
        unsafe {
            CloseHandle(self.event);
        }
    }
}

pub fn start(app: &tauri::AppHandle) -> std::io::Result<()> {
    refresh(app, &mut None);
    let app = app.clone();
    std::thread::Builder::new()
        .name("nodecloak-shell-icons".into())
        .spawn(move || {
            let mut previous = None;
            loop {
                if let Some(watcher) = Watcher::new() {
                    loop {
                        // Register before reading so a change between read/wait isn't lost.
                        if !watcher.arm() {
                            break;
                        }
                        refresh(&app, &mut previous);
                        if !watcher.wait() {
                            break;
                        }
                    }
                }
                // Re-open deleted/missing keys; this fallback never blocks the UI.
                refresh(&app, &mut previous);
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_theme_is_independent_of_application_theme() {
        assert_eq!(theme_from_registry(Some(1)), Theme::Light);
        assert_eq!(theme_from_registry(Some(0)), Theme::Dark);
        assert_eq!(theme_from_registry(None), Theme::Dark);
        assert_eq!(theme_from_registry(Some(99)), Theme::Dark);
    }

    #[test]
    fn both_shell_sizes_are_transparent_and_have_the_correct_foreground() {
        for tray in [true, false] {
            for (theme, foreground) in
                [(Theme::Light, [17, 21, 27]), (Theme::Dark, [246, 244, 239])]
            {
                let icon = image(theme, tray);
                let rgba = icon.rgba();
                assert_eq!(rgba.len(), (icon.width() * icon.height() * 4) as usize);
                assert_eq!(rgba[3], 0, "the corner must have no background");
                assert_eq!(rgba[rgba.len() - 1], 0);
                assert!(rgba
                    .chunks_exact(4)
                    .any(|pixel| pixel[..3] == foreground && pixel[3] == 255));
                // More than half the icon canvas is transparent, including the eye cutout.
                assert!(
                    rgba.chunks_exact(4).filter(|pixel| pixel[3] == 0).count() > rgba.len() / 8
                );
            }
        }
    }

    #[test]
    fn registry_watcher_can_register_without_modifying_system_settings() {
        if let Some(watcher) = Watcher::new() {
            assert!(watcher.arm());
        }
    }
}
