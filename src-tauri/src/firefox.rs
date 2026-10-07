//! Preferences are parsed as data, never evaluated as JavaScript.
use serde_json::{json, Value};
use std::{fs, path::Path};

pub const FONT_LIST: &str = "Arial,Calibri,Cambria,Consolas,Courier,Courier New,Georgia,Helvetica,Helvetica Neue,Menlo,Monaco,Segoe UI,Segoe UI Emoji,Segoe UI Symbol,Tahoma,Times,Times New Roman,Trebuchet MS,Verdana,Apple Color Emoji";
pub fn fields(id: &str) -> Result<Vec<(&'static str, Value)>, String> {
    Ok(match id {
        "fonts" => vec![("font.system.whitelist", json!(FONT_LIST))],
        "language" => vec![
            ("intl.accept_languages", json!("en-US,en")),
            ("intl.locale.requested", json!("en-US")),
            ("intl.regional_prefs.use_os_locales", json!(false)),
        ],
        "webrtc" => vec![("media.peerconnection.enabled", json!(false))],
        "dns" => vec![
            ("network.trr.mode", json!(3)),
            (
                "network.trr.uri",
                json!("https://cloudflare-dns.com/dns-query"),
            ),
        ],
        "tracking" => vec![
            ("privacy.globalprivacycontrol.enabled", json!(true)),
            (
                "privacy.globalprivacycontrol.functionality.enabled",
                json!(true),
            ),
        ],
        "startup" => vec![
            ("browser.startup.homepage", json!("about:blank")),
            ("browser.startup.page", json!(0)),
            ("browser.startup.homepage_override.mstone", json!("ignore")),
        ],
        _ => return Err("不支持的 Firefox 设置".into()),
    })
}
fn allowed(key: &str) -> bool {
    ["fonts", "language", "webrtc", "dns", "tracking", "startup"]
        .iter()
        .any(|id| fields(id).unwrap().iter().any(|(k, _)| *k == key))
}

pub fn prepare_startup(profile: &Path) -> Result<(), String> {
    let changes = fields("startup")?.into_iter().map(|(key, value)| {
        Ok((key.to_owned(), snapshot(profile, key)?, json!({"user":value,"runtime":value})))
    }).collect::<Result<Vec<_>, String>>()?;
    apply(profile, &changes, false)
}
fn document(path: &Path) -> Result<String, String> {
    match fs::metadata(path) {
        Ok(m) if m.len() > 16 * 1024 * 1024 => Err("Firefox 配置超出大小限制".into()),
        Ok(_) => fs::read_to_string(path).map_err(|e| format!("无法读取 Firefox 配置：{e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn value_in(text: &str, key: &str) -> Result<Option<Value>, String> {
    let mut found = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") || !trimmed.contains(key) {
            continue;
        }
        // Ambiguous/multiline controlled preferences must be reviewed instead of overwritten.
        let body = trimmed
            .strip_prefix("user_pref(")
            .and_then(|s| s.strip_suffix(");"))
            .ok_or("Firefox 设置格式无法安全解析，原文件已保留")?;
        let (name, value) = body.split_once(',').ok_or("Firefox 设置格式无效")?;
        let name: String = serde_json::from_str(name.trim()).map_err(|_| "Firefox 设置名称无效")?;
        if name != key {
            continue;
        }
        if found.is_some() {
            return Err("Firefox 配置含重复设置，原文件已保留".into());
        }
        let v: Value =
            serde_json::from_str(value.trim()).map_err(|_| "Firefox 设置值无法安全解析")?;
        if !(v.is_boolean() || v.is_string() || v.as_i64().is_some()) {
            return Err("Firefox 设置类型无效".into());
        }
        found = Some(v);
    }
    Ok(found)
}
pub fn snapshot(profile: &Path, key: &str) -> Result<Value, String> {
    if !allowed(key) {
        return Err("Firefox 设置不在允许列表内".into());
    }
    Ok(
        json!({"user":value_in(&document(&profile.join("user.js"))?,key)?, "runtime":value_in(&document(&profile.join("prefs.js"))?,key)?}),
    )
}
pub fn configured(profile: &Path, id: &str) -> Result<bool, String> {
    for (key, expected) in fields(id)? {
        let s = snapshot(profile, key)?;
        // Firefox may omit a preference equal to its default from prefs.js.
        // user.js still requests it on every startup; this is configuration, not web verification.
        if s["user"] != expected || (!s["runtime"].is_null() && s["runtime"] != expected) {
            return Ok(false);
        }
    }
    Ok(true)
}
fn replace(text: &str, key: &str, value: &Value) -> String {
    let mut result = String::new();
    for line in text.split_inclusive('\n') {
        if value_in(line, key).ok().flatten().is_some() {
            continue;
        }
        result.push_str(line);
    }
    if !value.is_null() {
        if !result.is_empty() && !result.ends_with('\n') {
            result.push('\n');
        }
        result.push_str(&format!("user_pref({}, {});\n", json!(key), value));
    }
    result
}
pub fn apply(profile: &Path, changes: &[(String, Value, Value)], undo: bool) -> Result<(), String> {
    crate::platform::ensure_profile_closed(profile)?;
    let mut documents = [
        document(&profile.join("user.js"))?,
        document(&profile.join("prefs.js"))?,
    ];
    for (key, before, after) in changes {
        if !allowed(key) {
            return Err("Firefox 备份字段无效".into());
        }
        for (i, part) in ["user", "runtime"].iter().enumerate() {
            let original = before.get(part).ok_or("Firefox 备份缺失")?;
            let target = after.get(part).ok_or("Firefox 备份缺失")?;
            if ![original, target]
                .iter()
                .all(|v| v.is_null() || v.is_boolean() || v.is_string() || v.as_i64().is_some())
            {
                return Err("Firefox 备份类型无效".into());
            }
            let current = value_in(&documents[i], key)?.unwrap_or(Value::Null);
            let omitted_runtime = *part == "runtime"
                && current.is_null()
                && value_in(&documents[0], key)?.unwrap_or(Value::Null) == after["user"];
            if current != *target && current != *original && !omitted_runtime {
                return Err("Firefox 设置已被其他程序修改，本次未覆盖。".into());
            }
        }
    }
    for (key, before, after) in changes {
        let desired = if undo { before } else { after };
        for (i, part) in ["user", "runtime"].iter().enumerate() {
            documents[i] = replace(&documents[i], key, &desired[part]);
        }
    }
    for (i, name) in ["user.js", "prefs.js"].iter().enumerate() {
        crate::engine::atomic_write(&profile.join(name), documents[i].as_bytes())?;
    }
    for (key, before, after) in changes {
        if snapshot(profile, key)? != *if undo { before } else { after } {
            return Err("Firefox 设置写入后验证失败，可从记录恢复".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dedicated_startup_overrides_homepage_without_changing_dns_or_login_data() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path().join("new profile");
        prepare_startup(&p).unwrap();
        fs::write(p.join("cookies.sqlite"), "login data").unwrap();
        fs::write(p.join("user.js"), "user_pref(\"browser.startup.homepage\", \"https://home.firefoxchina.cn\");\nuser_pref(\"network.trr.mode\", 3);\nuser_pref(\"font.system.whitelist\", \"Arial\");\n").unwrap();
        prepare_startup(&p).unwrap();
        prepare_startup(&p).unwrap();
        let text = document(&p.join("user.js")).unwrap();
        assert_eq!(value_in(&text, "browser.startup.homepage").unwrap(), Some(json!("about:blank")));
        assert_eq!(value_in(&text, "network.trr.mode").unwrap(), Some(json!(3)));
        assert_eq!(value_in(&text, "font.system.whitelist").unwrap(), Some(json!("Arial")));
        assert!(!text.contains("firefoxchina.cn"));
        assert_eq!(fs::read_to_string(p.join("cookies.sqlite")).unwrap(), "login data");
        assert_eq!(text.matches("user_pref(\"browser.startup.homepage\",").count(), 1);
    }
    #[test]
    fn restores_runtime_and_startup_values_without_erasing_unrelated_changes() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        fs::write(p.join("prefs.js"), "// keep\nuser_pref(\"font.system.whitelist\", \"Arial,SimSun\");\nuser_pref(\"unrelated\", 42);\n").unwrap();
        let before = snapshot(p, "font.system.whitelist").unwrap();
        let after = json!({"user":FONT_LIST,"runtime":FONT_LIST});
        let changes = vec![("font.system.whitelist".into(), before.clone(), after)];
        apply(p, &changes, false).unwrap();
        assert!(configured(p, "fonts").unwrap());
        fs::write(
            p.join("user.js"),
            format!(
                "{}user_pref(\"new.other\", true);\n",
                document(&p.join("user.js")).unwrap()
            ),
        )
        .unwrap();
        apply(p, &changes, true).unwrap();
        assert_eq!(snapshot(p, "font.system.whitelist").unwrap(), before);
        assert!(document(&p.join("prefs.js")).unwrap().contains("unrelated"));
        assert!(document(&p.join("user.js")).unwrap().contains("new.other"));
        assert!(!document(&p.join("user.js"))
            .unwrap()
            .contains("font.system.whitelist"));
    }
    #[test]
    fn malformed_duplicate_or_conflicting_preferences_are_preserved() {
        for bad in ["user_pref(\"font.system.whitelist\", function(){});", "user_pref(\"font.system.whitelist\", \"Arial\");\nuser_pref(\"font.system.whitelist\", \"Calibri\");", "user_pref(\"font.system.whitelist\",\n\"Arial\");"] { assert!(value_in(bad,"font.system.whitelist").is_err()); }
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        fs::write(
            p.join("user.js"),
            "user_pref(\"font.system.whitelist\", \"My newer choice\");\n",
        )
        .unwrap();
        let original = fs::read(p.join("user.js")).unwrap();
        assert!(apply(
            p,
            &[(
                "font.system.whitelist".into(),
                json!({"user":null,"runtime":null}),
                json!({"user":FONT_LIST,"runtime":FONT_LIST})
            )],
            true
        )
        .is_err());
        assert_eq!(fs::read(p.join("user.js")).unwrap(), original);
        assert!(!p.join("prefs.js").exists());
    }
    #[test]
    fn omitted_runtime_defaults_and_unrelated_strings_survive_restore() {
        let temp = tempfile::tempdir().unwrap();
        let p = temp.path();
        fs::write(p.join("prefs.js"),"user_pref(\"intl.regional_prefs.use_os_locales\", true);\nuser_pref(\"other\", \"font.system.whitelist\");\n").unwrap();
        let before = snapshot(p, "intl.regional_prefs.use_os_locales").unwrap();
        let changes = vec![(
            "intl.regional_prefs.use_os_locales".into(),
            before.clone(),
            json!({"user":false,"runtime":false}),
        )];
        apply(p, &changes, false).unwrap();
        fs::write(
            p.join("prefs.js"),
            "user_pref(\"other\", \"font.system.whitelist\");\n",
        )
        .unwrap();
        apply(p, &changes, true).unwrap();
        assert_eq!(
            snapshot(p, "intl.regional_prefs.use_os_locales").unwrap(),
            before
        );
        assert!(document(&p.join("prefs.js"))
            .unwrap()
            .contains("\"other\", \"font.system.whitelist\""));
        let font_before = snapshot(p, "font.system.whitelist").unwrap();
        apply(
            p,
            &[(
                "font.system.whitelist".into(),
                font_before,
                json!({"user":FONT_LIST,"runtime":FONT_LIST}),
            )],
            false,
        )
        .unwrap();
        assert!(document(&p.join("prefs.js"))
            .unwrap()
            .contains("\"other\", \"font.system.whitelist\""));
    }
}
