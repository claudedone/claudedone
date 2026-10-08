use reqwest::Client;

const BODY_LIMIT: usize = 96 * 1024;

pub struct Probe {
    pub reachable: bool,
    pub label: String,
}

// The generic Cloudflare trace can follow a different split-routing rule.
// Query the target hostname itself and only accept its bounded trace response.
pub async fn trace(client: &Client, url: &str) -> Option<String> {
    let requested = reqwest::Url::parse(url).ok()?;
    let mut response = client.get(url).send().await.ok()?;
    if !response.status().is_success()
        || response.url().host_str() != requested.host_str()
        || response.url().path() != "/cdn-cgi/trace"
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > 8192 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = std::str::from_utf8(&bytes).ok()?;
    let value = |key: &str| body.lines().find_map(|line| line.strip_prefix(key));
    if value("h=")? != requested.host_str()? {
        return None;
    }
    let ip = value("ip=")?.parse::<std::net::IpAddr>().ok()?;
    let country = value("loc=")?;
    if country.len() != 2 || !country.bytes().all(|c| c.is_ascii_uppercase()) {
        return None;
    }
    Some(format!("同域名 TCP 检测出口 {ip}（{country}）"))
}

fn unavailable(url: &reqwest::Url, body: &str) -> bool {
    if url.path().trim_end_matches('/') == "/app-unavailable-in-region" {
        return true;
    }
    let body = body.to_ascii_lowercase();
    let Some(start) = body.find("<h1") else {
        return false;
    };
    let Some(end) = body[start..].find("</h1>") else {
        return false;
    };
    let mut in_tag = false;
    let heading: String = body[start..start + end]
        .chars()
        .filter(|c| {
            if *c == '<' {
                in_tag = true;
                return false;
            }
            if *c == '>' {
                in_tag = false;
                return false;
            }
            !in_tag
        })
        .collect();
    heading
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .contains("app unavailable")
        && body.contains("only available in certain regions")
}

pub async fn probe(client: &Client, url: &str) -> Probe {
    let mut response = match client.get(url).send().await {
        Ok(response) => response,
        Err(_) => {
            return Probe {
                reachable: false,
                label: "连接失败 / 超时".into(),
            }
        }
    };
    let code = response.status().as_u16();
    let final_url = response.url().clone();
    // The official availability page is HTTP 200, including after redirects.
    if unavailable(&final_url, "") {
        return Probe {
            reachable: false,
            label: format!("地区不可用页面（HTTP {code}）"),
        };
    }
    let mut bytes = Vec::new();
    let mut truncated = false;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = BODY_LIMIT - bytes.len();
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if chunk.len() > remaining {
                    truncated = true;
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => {
                return Probe {
                    reachable: false,
                    label: format!("HTTP {code} · 页面读取失败，需浏览器复检"),
                }
            }
        }
    }
    let body = String::from_utf8_lossy(&bytes);
    if unavailable(&final_url, &body) {
        return Probe {
            reachable: false,
            label: format!("地区不可用页面（HTTP {code}）"),
        };
    }
    let lower = body.to_ascii_lowercase();
    if lower.contains("cf-chl-") || lower.contains("<title>just a moment") {
        return Probe {
            reachable: false,
            label: format!("HTTP {code} · 需要浏览器验证"),
        };
    }
    if !(200..300).contains(&code) || truncated || bytes.is_empty() {
        return Probe {
            reachable: false,
            label: format!("HTTP {code} · 页面需浏览器复检"),
        };
    }
    Probe {
        reachable: true,
        label: format!("HTTP {code} · 页面可达，账号可用性待复检"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::AsyncWriteExt, net::TcpListener};

    #[tokio::test]
    async fn target_trace_validates_hostname_address_country_and_size() {
        use tokio::io::AsyncReadExt;
        for (status, body, valid) in [
            (200, "h=127.0.0.1\nip=192.0.2.1\nloc=SG\n".to_owned(), true),
            (
                200,
                "h=127.0.0.1\nip=2001:db8::1\nloc=SG\n".to_owned(),
                true,
            ),
            (
                200,
                "h=other.example\nip=192.0.2.1\nloc=SG\n".to_owned(),
                false,
            ),
            (200, "h=127.0.0.1\nip=invalid\nloc=SG\n".to_owned(), false),
            (
                200,
                "h=127.0.0.1\nip=192.0.2.1\nloc=Singapore\n".to_owned(),
                false,
            ),
            (403, "h=127.0.0.1\nip=192.0.2.1\nloc=SG\n".to_owned(), false),
            (200, "<title>Just a moment...</title>".to_owned(), false),
            (200, "x".repeat(8193), false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/cdn-cgi/trace", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                socket.read(&mut request).await.unwrap();
                let wire = format!(
                    "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(wire.as_bytes()).await;
            });
            let client = Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .unwrap();
            let result = trace(&client, &url).await;
            server.await.unwrap();
            assert_eq!(result.is_some(), valid);
            if let Some(label) = result {
                assert!(label.contains("同域名 TCP 检测出口") && label.ends_with("（SG）"));
            }
        }
    }

    async fn check(path: &str, status: u16, body: &str) -> Probe {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}{path}", listener.local_addr().unwrap());
        let wire = format!(
            "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let server = tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 2048];
            socket.read(&mut request).await.unwrap();
            let _ = socket.write_all(wire.as_bytes()).await;
        });
        let client = Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap();
        let result = probe(&client, &url).await;
        server.await.unwrap();
        result
    }

    #[tokio::test]
    async fn http_200_unavailable_pages_are_not_healthy() {
        let by_url = check("/app-unavailable-in-region?fp=1", 200, "empty").await;
        assert!(!by_url.reachable && by_url.label.contains("地区不可用"));
        let by_body = check("/", 200, "<h1 class='title'><span>App unavailable</span></h1>Unfortunately, Claude is only available in certain regions right now.").await;
        assert!(!by_body.reachable && by_body.label.contains("地区不可用"));
    }

    #[tokio::test]
    async fn challenge_errors_and_oversized_pages_remain_unverified() {
        assert!(
            !check("/", 200, "<title>Just a moment...</title>")
                .await
                .reachable
        );
        assert!(!check("/", 403, "Forbidden").await.reachable);
        assert!(!check("/", 200, &"x".repeat(BODY_LIMIT + 1)).await.reachable);
    }

    #[tokio::test]
    async fn redirect_to_http_200_availability_error_is_not_healthy() {
        use tokio::io::AsyncReadExt;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for reply in [
                "HTTP/1.1 302 Found\r\nLocation: /app-unavailable-in-region\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbody",
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                socket.read(&mut request).await.unwrap();
                let _ = socket.write_all(reply.as_bytes()).await;
            }
        });
        let client = Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap();
        let result = probe(&client, &url).await;
        server.await.unwrap();
        assert!(!result.reachable && result.label.contains("地区不可用"));
    }

    #[tokio::test]
    async fn reachable_page_does_not_claim_account_access() {
        let result = check(
            "/",
            200,
            "<h1>Welcome</h1><script>const route='app-unavailable-in-region';</script>",
        )
        .await;
        assert!(result.reachable);
        assert!(result.label.contains("账号可用性待复检"));
    }
}
