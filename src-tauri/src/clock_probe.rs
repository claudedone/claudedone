use crate::engine::Check;
use chrono::{DateTime, Utc};
use std::time::{Duration, Instant};

pub fn unknown() -> Check {
    Check {
        id: "clock".into(), status: "unknown".into(), value: "时间准确性尚未确认".into(),
        detail: "未取得可靠的 HTTPS 时间参考。时区和 UTC 偏移正常不代表电脑时间准确；请在系统日期与时间中启用自动设置时间并同步。".into(),
        fixable: false,
    }
}

fn assess(body: &str, start: DateTime<Utc>, end: DateTime<Utc>, elapsed: Duration) -> Check {
    let mut result = unknown();
    // Trace timestamps are generated at the edge; tolerate transit time and up to
    // two minutes of clock difference. Never use timezone offsets to adjust UTC.
    let times: Vec<_> = body.lines().filter_map(|s| s.strip_prefix("ts=")).collect();
    if times.len() != 1 {
        return result;
    }
    let Some(server) = times[0]
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v > 0.0 && *v < 253402300799.0)
    else {
        return result;
    };
    let span = (end - start).num_milliseconds() as f64 / 1000.0;
    if elapsed > Duration::from_secs(15) || span < 0.0 || (span - elapsed.as_secs_f64()).abs() > 2.0
    {
        return result;
    }
    let first = start.timestamp_millis() as f64 / 1000.0;
    let last = end.timestamp_millis() as f64 / 1000.0;
    let difference = ((first + last) / 2.0 - server).round() as i64;
    let skewed = server < first - 120.0 || server > last + 120.0;
    result.status = if skewed { "warning" } else { "healthy" }.into();
    result.value = if skewed {
        format!("电脑时间与 HTTPS 参考相差约 {} 秒", difference.abs())
    } else {
        "电脑时间与 HTTPS 参考偏差在 2 分钟内".into()
    };
    result.detail = "参考为 Cloudflare HTTPS 响应的服务端时间，包含网络延迟容差，不能替代系统时间同步。若网页提示 Incorrect device time，请启用系统自动设置时间并立即同步；修改时区不会校准时钟。".into();
    result
}

// Reuse the exit-IP request and its proxy path; TLS checks remain enabled.
pub async fn fetch(client: &reqwest::Client) -> Result<(String, Check), String> {
    let start = Utc::now();
    let timer = Instant::now();
    let mut response = client
        .get("https://www.cloudflare.com/cdn-cgi/trace")
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| "时间与出口检测失败，请检查网络、代理以及系统日期与时间")?;
    if !response.status().is_success() {
        return Err("出口检测服务暂时不可用，请重试".into());
    }
    let valid = response.url().scheme() == "https"
        && response.url().host_str() == Some("www.cloudflare.com")
        && response.url().path() == "/cdn-cgi/trace"
        && response
            .headers()
            .get(reqwest::header::AGE)
            .is_none_or(|v| v.to_str().ok() == Some("0"));
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "无法读取出口检测结果")? {
        if bytes.len() + chunk.len() > 8192 {
            return Err("出口检测结果过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let end = Utc::now();
    let elapsed = timer.elapsed();
    let body = String::from_utf8(bytes).map_err(|_| "出口检测结果格式无效")?;
    let host = body
        .lines()
        .filter_map(|s| s.strip_prefix("h="))
        .collect::<Vec<_>>();
    let check = if valid && host == ["www.cloudflare.com"] {
        assess(&body, start, end, elapsed)
    } else {
        unknown()
    };
    Ok((body, check))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Uses the live Cloudflare HTTPS timestamp; does not change the system clock"]
    async fn live_https_clock_reference_is_observed_without_modifying_time() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        let (_, check) = fetch(&client).await.unwrap();
        println!("{}: {}", check.status, check.value);
        assert_ne!(check.status, "unknown");
        assert!(!check.fixable);
    }
    fn at(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds, 0).unwrap()
    }
    #[test]
    fn compares_absolute_time_without_changing_local_time_or_timezone() {
        let now = 1791600000;
        let normal = assess(
            &format!("ts={now}.000\n"),
            at(now),
            at(now + 1),
            Duration::from_secs(1),
        );
        assert_eq!(normal.status, "healthy");
        assert!(!normal.fixable);
        for hours in [-8, 8] {
            let skewed = assess(
                &format!("ts={now}.500\n"),
                at(now + hours * 3600),
                at(now + hours * 3600 + 1),
                Duration::from_secs(1),
            );
            assert_eq!(skewed.status, "warning");
            assert!(skewed.value.contains("28800"));
        }
    }
    #[test]
    fn treats_missing_invalid_slow_or_clock_jumping_samples_as_unknown() {
        let now = 1791600000;
        for body in [
            "",
            "ts=NaN\n",
            "ts=inf\n",
            "ts=-1\n",
            "ts=1791600000\nts=1791600000\n",
            "ts=1e99\n",
        ] {
            assert_eq!(
                assess(body, at(now), at(now + 1), Duration::from_secs(1)).status,
                "unknown"
            );
        }
        assert_eq!(
            assess(
                &format!("ts={now}\n"),
                at(now),
                at(now + 30),
                Duration::from_secs(30)
            )
            .status,
            "unknown"
        );
        assert_eq!(
            assess(
                &format!("ts={now}\n"),
                at(now),
                at(now + 3600),
                Duration::from_secs(1)
            )
            .status,
            "unknown"
        );
    }
}
