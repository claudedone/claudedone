use crate::{
    profiles::{PermissionMode, Preferences},
    proxy::{self, Upstream},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct RegionalSettings {
    pub language_mode: String,
    pub timezone_mode: String,
    pub timezone: String,
    pub location_mode: String,
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy: f64,
}
impl Default for RegionalSettings {
    fn default() -> Self {
        Self {
            language_mode: "custom".into(),
            timezone_mode: "system".into(),
            timezone: "UTC".into(),
            location_mode: "system".into(),
            latitude: 1.3521,
            longitude: 103.8198,
            accuracy: 100.0,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IpRegion {
    pub ip: String,
    pub country: String,
    pub city: String,
    pub language: String,
    pub timezone: String,
    pub latitude: f64,
    pub longitude: f64,
    pub checked_at: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRegion {
    pub language: String,
    pub timezone: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub accuracy: f64,
    pub ip_region: Option<IpRegion>,
}
pub fn needs_control(p: &Preferences) -> bool {
    p.regional.language_mode == "ip"
        || p.regional.timezone_mode != "system"
        || p.regional.location_mode != "system"
}
/// Compatibility for saved settings from before per-profile sources were removed.
pub fn normalize_sources(p: &mut Preferences) -> bool {
    let before = p.clone();
    if p.regional.location_mode != "system" && p.advanced.location == PermissionMode::Allow {
        p.advanced.location = PermissionMode::Ask;
    }
    let language_mode = p.regional.language_mode.clone();
    p.regional = RegionalSettings {
        language_mode,
        ..RegionalSettings::default()
    };
    *p != before
}
pub fn uses_ip(p: &Preferences) -> bool {
    p.regional.language_mode == "ip"
        || p.regional.timezone_mode == "ip"
        || (p.regional.location_mode == "ip" && p.advanced.location != PermissionMode::Block)
}
pub fn valid_timezone(value: &str) -> bool {
    value.len() <= 100 && value.parse::<chrono_tz::Tz>().is_ok()
}
pub fn validate(p: &Preferences) -> Result<(), String> {
    let r = &p.regional;
    if !["ip", "custom"].contains(&r.language_mode.as_str())
        || !["system", "ip", "custom"].contains(&r.timezone_mode.as_str())
        || !["system", "ip", "custom"].contains(&r.location_mode.as_str())
    {
        return Err("区域匹配方式无效".into());
    }
    if r.timezone_mode == "custom" && !valid_timezone(&r.timezone) {
        return Err("请填写有效的 IANA 时区，例如 America/Los_Angeles".into());
    }
    if !r.latitude.is_finite()
        || !r.longitude.is_finite()
        || !r.accuracy.is_finite()
        || !(-90.0..=90.0).contains(&r.latitude)
        || !(-180.0..=180.0).contains(&r.longitude)
        || !(1.0..=100_000.0).contains(&r.accuracy)
    {
        return Err("经纬度或定位精度无效".into());
    }
    if needs_control(p) && p.advanced.resist_fingerprinting {
        return Err("独立区域设置与 Firefox 严格指纹保护冲突，请关闭严格保护".into());
    }
    if [
        &p.advanced.notifications,
        &p.advanced.camera,
        &p.advanced.microphone,
    ]
    .contains(&&PermissionMode::Allow)
    {
        return Err("仅地理位置支持允许模式".into());
    }
    Ok(())
}
fn language(country: &str) -> String {
    let primary = match country {
        "US" => "en-US",
        "GB" => "en-GB",
        "CA" => "en-CA",
        "AU" => "en-AU",
        "NZ" => "en-NZ",
        "IE" => "en-IE",
        "SG" => "en-SG",
        "DE" => "de-DE",
        "AT" => "de-AT",
        "CH" => "de-CH",
        "FR" => "fr-FR",
        "BE" => "nl-BE",
        "NL" => "nl-NL",
        "IT" => "it-IT",
        "ES" => "es-ES",
        "MX" => "es-MX",
        "AR" => "es-AR",
        "CL" => "es-CL",
        "CO" => "es-CO",
        "PE" => "es-PE",
        "PT" => "pt-PT",
        "BR" => "pt-BR",
        "JP" => "ja-JP",
        "KR" => "ko-KR",
        "TW" => "zh-TW",
        "HK" => "zh-HK",
        "CN" => "zh-CN",
        "VN" => "vi-VN",
        "TH" => "th-TH",
        "ID" => "id-ID",
        "MY" => "ms-MY",
        "PH" => "en-PH",
        "IN" => "en-IN",
        "PL" => "pl-PL",
        "CZ" => "cs-CZ",
        "SK" => "sk-SK",
        "HU" => "hu-HU",
        "RO" => "ro-RO",
        "BG" => "bg-BG",
        "GR" => "el-GR",
        "SE" => "sv-SE",
        "NO" => "nb-NO",
        "DK" => "da-DK",
        "FI" => "fi-FI",
        "IS" => "is-IS",
        "EE" => "et-EE",
        "LT" => "lt-LT",
        "LV" => "lv-LV",
        "RU" => "ru-RU",
        "UA" => "uk-UA",
        "TR" => "tr-TR",
        "IL" => "he-IL",
        "SA" => "ar-SA",
        "AE" => "ar-AE",
        "EG" => "ar-EG",
        "ZA" => "en-ZA",
        _ => "en",
    };
    let base = primary.split('-').next().unwrap();
    if base == "en" {
        if primary == "en" {
            "en".into()
        } else {
            format!("{primary},en")
        }
    } else {
        format!("{primary},{base},en")
    }
}
pub fn parse_ip_region(data: &Value) -> Result<IpRegion, String> {
    if data["success"] != true {
        return Err("IP 区域查询失败，请稍后重试或使用自定义设置".into());
    }
    let ip = data["ip"]
        .as_str()
        .filter(|s| s.parse::<std::net::IpAddr>().is_ok())
        .ok_or("区域服务没有返回有效 IP")?;
    let country = data["country_code"]
        .as_str()
        .filter(|s| s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase()))
        .ok_or("区域服务没有返回有效国家")?;
    let timezone = data["timezone"]["id"]
        .as_str()
        .filter(|s| valid_timezone(s))
        .ok_or("区域服务没有返回有效时区，请使用自定义设置")?;
    let latitude = data["latitude"]
        .as_f64()
        .filter(|x| (-90.0..=90.0).contains(x))
        .ok_or("区域服务没有返回有效纬度")?;
    let longitude = data["longitude"]
        .as_f64()
        .filter(|x| (-180.0..=180.0).contains(x))
        .ok_or("区域服务没有返回有效经度")?;
    Ok(IpRegion {
        ip: ip.into(),
        country: country.into(),
        city: data["city"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(100)
            .collect(),
        language: language(country),
        timezone: timezone.into(),
        latitude,
        longitude,
        checked_at: chrono::Utc::now().to_rfc3339(),
    })
}
pub const LOOKUP_URL: &str =
    "https://ipwho.is/?fields=success,ip,country_code,city,latitude,longitude,timezone.id";
pub async fn lookup(up: Upstream) -> Result<IpRegion, String> {
    let (client, _relay) = proxy::http_client(up).await?;
    let response = client
        .get(LOOKUP_URL)
        .send()
        .await
        .map_err(|_| "无法通过此副本的网络路径匹配 IP 区域，请检查代理或使用自定义设置")?;
    if !response.status().is_success() {
        return Err("IP 区域服务暂时不可用或请求过多，请稍后重试".into());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "区域响应读取失败")? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 65536 {
            return Err("区域响应过大".into());
        }
    }
    parse_ip_region(&serde_json::from_slice(&bytes).map_err(|_| "区域响应格式无效")?)
}
/// Only used while the browser is still on about:blank. Target pages wait for resolve().
pub fn initial(p: &Preferences) -> Result<ResolvedRegion, String> {
    validate(p)?;
    Ok(ResolvedRegion {
        language: p.language.clone(),
        timezone: if p.regional.timezone_mode == "custom" {
            Some(p.regional.timezone.clone())
        } else {
            None
        },
        latitude: None,
        longitude: None,
        accuracy: p.regional.accuracy,
        ip_region: None,
    })
}
pub fn resolve(p: &Preferences, ip: Option<IpRegion>) -> Result<ResolvedRegion, String> {
    validate(p)?;
    if uses_ip(p) && ip.is_none() {
        return Err("跟随 IP 设置尚未匹配，不会使用电脑的真实区域代替".into());
    }
    let r = &p.regional;
    Ok(ResolvedRegion {
        language: if r.language_mode == "ip" {
            ip.as_ref().unwrap().language.clone()
        } else {
            p.language.clone()
        },
        timezone: match r.timezone_mode.as_str() {
            "custom" => Some(r.timezone.clone()),
            "ip" => Some(ip.as_ref().unwrap().timezone.clone()),
            _ => None,
        },
        latitude: if p.advanced.location == PermissionMode::Block {
            None
        } else {
            match r.location_mode.as_str() {
                "custom" => Some(r.latitude),
                "ip" => Some(ip.as_ref().unwrap().latitude),
                _ => None,
            }
        },
        longitude: if p.advanced.location == PermissionMode::Block {
            None
        } else {
            match r.location_mode.as_str() {
                "custom" => Some(r.longitude),
                "ip" => Some(ip.as_ref().unwrap().longitude),
                _ => None,
            }
        },
        accuracy: if r.location_mode == "ip" {
            20_000.0
        } else {
            r.accuracy
        },
        ip_region: ip,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_locations_timezones_and_strict_conflicts() {
        let mut p = Preferences::default();
        p.regional.timezone_mode = "custom".into();
        p.regional.timezone = "Asia/Tokyo".into();
        assert!(validate(&p).is_ok());
        p.regional.timezone = "Invalid/Zone".into();
        assert!(validate(&p).is_err());
        p.regional.timezone = "UTC".into();
        p.advanced.resist_fingerprinting = true;
        assert!(validate(&p).is_err());
        p.advanced.resist_fingerprinting = false;
        p.regional.latitude = 91.0;
        assert!(validate(&p).is_err());
    }
    #[test]
    fn matches_ip_and_never_substitutes_system_on_failure() {
        let value = serde_json::json!({"success":true,"ip":"203.0.113.12","country_code":"JP","city":"Tokyo","latitude":35.68,"longitude":139.69,"timezone":{"id":"Asia/Tokyo"}});
        let ip = parse_ip_region(&value).unwrap();
        let mut p = Preferences::default();
        p.regional.language_mode = "ip".into();
        p.regional.timezone_mode = "ip".into();
        p.regional.location_mode = "ip".into();
        assert!(resolve(&p, None).is_err());
        let resolved = resolve(&p, Some(ip)).unwrap();
        assert_eq!(resolved.language, "ja-JP,ja,en");
        assert_eq!(resolved.timezone.as_deref(), Some("Asia/Tokyo"));
        assert_eq!(resolved.latitude, Some(35.68));
        assert!(parse_ip_region(&serde_json::json!({"success":false})).is_err());
    }
}
