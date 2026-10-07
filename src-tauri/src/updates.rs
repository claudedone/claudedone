use serde::{Deserialize, Serialize};
use std::time::Duration;

const ENDPOINT: &str = "https://claudedone.com/updates/latest.json";
const MAX_BYTES: usize = 32 * 1024;

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(rename = "publishedAt")]
    published_at: String,
    notes: Vec<String>,
    platforms: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    current_version: String,
    latest_version: String,
    available: bool,
    supported: bool,
    notes: Vec<String>,
    published_at: String,
    checked_at: String,
}

fn version_parts(value: &str) -> Result<[u64; 3], String> {
    let components: Vec<&str> = value.split('.').collect();
    if components.len() != 3 {
        return Err("官网版本号格式不正确，请稍后重试。".into());
    }
    let mut parts = [0; 3];
    for (i, component) in components.iter().enumerate() {
        if component.is_empty()
            || !component.bytes().all(|b| b.is_ascii_digit())
            || (component.len() > 1 && component.starts_with('0'))
        {
            return Err("官网版本号格式不正确，请稍后重试。".into());
        }
        parts[i] = component.parse().map_err(|_| "官网版本号超出有效范围。")?;
    }
    Ok(parts)
}

fn parse_manifest(bytes: &[u8], current: &str, platform: &str) -> Result<UpdateCheck, String> {
    if bytes.len() > MAX_BYTES {
        return Err("官网更新信息过大，请稍后重试。".into());
    }
    let manifest: Manifest = serde_json::from_slice(bytes)
        .map_err(|_| "官网更新信息暂时不可用，请稍后重试。".to_string())?;
    let newer = version_parts(&manifest.version)? > version_parts(current)?;
    if manifest.notes.len() > 20
        || manifest.notes.iter().any(|note| note.len() > 2000)
        || chrono::DateTime::parse_from_rfc3339(&manifest.published_at).is_err()
        || manifest.platforms.iter().any(|p| {
            !matches!(
                p.as_str(),
                "windows-x86_64" | "macos-x86_64" | "macos-aarch64"
            )
        })
    {
        return Err("官网更新信息格式不正确，请稍后重试。".into());
    }
    let supported = manifest.platforms.iter().any(|p| p == platform);
    Ok(UpdateCheck {
        current_version: current.into(),
        latest_version: manifest.version,
        available: newer && supported,
        supported,
        notes: manifest.notes,
        published_at: manifest.published_at,
        checked_at: chrono::Utc::now().to_rfc3339(),
    })
}

pub async fn check() -> Result<UpdateCheck, String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("ClaudeDone/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "无法初始化更新检查，请稍后重试。".to_string())?;
    let mut response = client
        .get(ENDPOINT)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| "连接官网失败，请检查网络后重试。".to_string())?;
    if !response.status().is_success() {
        return Err("官网更新服务暂时不可用，请稍后重试。".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BYTES as u64)
    {
        return Err("官网更新信息过大，请稍后重试。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "更新信息读取失败，请稍后重试。".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("官网更新信息过大，请稍后重试。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    parse_manifest(&bytes, env!("CARGO_PKG_VERSION"), &platform)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(version: &str, platforms: &[&str]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"version":version,"publishedAt":"2026-10-03T00:00:00Z","notes":["新增更新检查"],"platforms":platforms})).unwrap()
    }
    #[test]
    fn numeric_comparison_prevents_false_updates_and_downgrades() {
        assert!(
            parse_manifest(
                &fixture("0.10.0", &["windows-x86_64"]),
                "0.9.9",
                "windows-x86_64"
            )
            .unwrap()
            .available
        );
        for latest in ["0.5.3", "0.5.2"] {
            assert!(
                !parse_manifest(
                    &fixture(latest, &["windows-x86_64"]),
                    "0.5.3",
                    "windows-x86_64"
                )
                .unwrap()
                .available
            );
        }
    }
    #[test]
    fn an_unreleased_platform_is_not_reported_as_up_to_date_or_downloadable() {
        let check = parse_manifest(
            &fixture("0.6.0", &["windows-x86_64"]),
            "0.5.3",
            "macos-aarch64",
        )
        .unwrap();
        assert!(!check.available);
        assert!(!check.supported);
    }
    #[test]
    fn malformed_and_oversized_metadata_never_counts_as_a_successful_check() {
        for version in [
            "0.5",
            "0.5.4-beta",
            "00.5.4",
            "0.+5.4",
            "0.5.18446744073709551616",
        ] {
            assert!(parse_manifest(
                &fixture(version, &["windows-x86_64"]),
                "0.5.3",
                "windows-x86_64"
            )
            .is_err());
        }
        assert!(parse_manifest(b"<html>offline</html>", "0.5.3", "windows-x86_64").is_err());
        assert!(parse_manifest(&vec![b' '; MAX_BYTES + 1], "0.5.3", "windows-x86_64").is_err());
    }
    #[test]
    #[ignore = "Requires the deployed HTTPS endpoint; run explicitly after publishing"]
    fn live_website_manifest_is_readable_by_the_native_client() {
        let check = tauri::async_runtime::block_on(check()).unwrap();
        assert_eq!(check.current_version, env!("CARGO_PKG_VERSION"));
        assert!(!check.latest_version.is_empty());
        println!("Native HTTPS update check: {check:?}");
    }
}
