use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::watch,
};

#[derive(Clone, Serialize, Deserialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(default = "system_mode")]
    pub mode: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential_ref: Option<String>,
}
fn system_mode() -> String {
    "system".into()
}
impl ProxyConfig {
    pub fn system() -> Self {
        Self {
            mode: system_mode(),
            ..Self::default()
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if !["direct", "system", "http", "https", "socks5"].contains(&self.mode.as_str()) {
            return Err("不支持的代理协议".into());
        }
        if self.custom() {
            if self.port == 0
                || self.host.is_empty()
                || self.host.len() > 253
                || self
                    .host
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control() || "/\\@?#".contains(c))
            {
                return Err("请填写有效的代理地址和端口".into());
            }
            if self.host.parse::<IpAddr>().is_err()
                && !self.host.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && label
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                })
            {
                return Err("代理地址应为 IP 或域名，不要包含协议或路径".into());
            }
            if self.username.as_bytes().len() > 255
                || self.username.chars().any(|c| c.is_control() || c == ':')
            {
                return Err("代理用户名格式无效".into());
            }
        }
        Ok(())
    }
    pub fn custom(&self) -> bool {
        ["http", "https", "socks5"].contains(&self.mode.as_str())
    }
}
pub struct Upstream {
    pub config: ProxyConfig,
    pub password: String,
}
impl Upstream {
    pub fn validate(&self) -> Result<(), String> {
        self.config.validate()?;
        if self.password.as_bytes().len() > 255 || self.password.chars().any(char::is_control) {
            return Err("代理密码格式无效或超过 255 字节".into());
        }
        Ok(())
    }
}
trait Stream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> Stream for T {}
type Socket = Box<dyn Stream>;
fn authority(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}
fn credentials(up: &Upstream) -> String {
    if up.config.username.is_empty() {
        String::new()
    } else {
        format!(
            "Proxy-Authorization: Basic {}\r\n",
            STANDARD.encode(format!("{}:{}", up.config.username, up.password))
        )
    }
}
async fn header(stream: &mut (impl AsyncRead + Unpin + ?Sized)) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while bytes.len() < 65536 {
        let b = stream.read_u8().await.map_err(|_| "连接在读取响应时中断")?;
        bytes.push(b);
        if bytes.ends_with(b"\r\n\r\n") {
            return Ok(bytes);
        }
    }
    Err("代理响应头过大".into())
}
async fn upstream_socket(up: &Upstream) -> Result<Socket, String> {
    let socket = TcpStream::connect((up.config.host.as_str(), up.config.port))
        .await
        .map_err(|_| "无法连接代理地址，请检查节点和端口")?;
    if up.config.mode == "https" {
        let connector =
            tokio_native_tls::native_tls::TlsConnector::new().map_err(|_| "无法初始化代理 TLS")?;
        let socket = tokio_native_tls::TlsConnector::from(connector)
            .connect(&up.config.host, socket)
            .await
            .map_err(|_| "代理 TLS 校验失败，请检查证书和代理协议")?;
        Ok(Box::new(socket))
    } else {
        Ok(Box::new(socket))
    }
}
async fn tunnel(up: &Upstream, host: &str, port: u16) -> Result<Socket, String> {
    let mut socket = upstream_socket(up).await?;
    if up.config.mode == "socks5" {
        let auth = !up.config.username.is_empty();
        socket
            .write_all(if auth { &[5, 1, 2] } else { &[5, 1, 0] })
            .await
            .map_err(|_| "SOCKS5 握手失败")?;
        let mut response = [0; 2];
        socket
            .read_exact(&mut response)
            .await
            .map_err(|_| "SOCKS5 握手失败")?;
        if response != [5, if auth { 2 } else { 0 }] {
            return Err("SOCKS5 认证方式不匹配".into());
        }
        if auth {
            let username = up.config.username.as_bytes();
            let password = up.password.as_bytes();
            let mut bytes = vec![1, username.len() as u8];
            bytes.extend(username);
            bytes.push(password.len() as u8);
            bytes.extend(password);
            socket
                .write_all(&bytes)
                .await
                .map_err(|_| "SOCKS5 认证失败")?;
            socket
                .read_exact(&mut response)
                .await
                .map_err(|_| "SOCKS5 认证失败")?;
            if response != [1, 0] {
                return Err("代理认证失败，请检查用户名和密码".into());
            }
        }
        if host.len() > 255 {
            return Err("目标域名过长".into());
        }
        let mut request = vec![5, 1, 0, 3, host.len() as u8];
        request.extend(host.as_bytes());
        request.extend(port.to_be_bytes());
        socket
            .write_all(&request)
            .await
            .map_err(|_| "SOCKS5 请求失败")?;
        let mut reply = [0; 4];
        socket
            .read_exact(&mut reply)
            .await
            .map_err(|_| "SOCKS5 响应失败")?;
        if reply[0] != 5 || reply[1] != 0 {
            return Err("代理无法连接目标网站".into());
        }
        let len = match reply[3] {
            1 => 4,
            4 => 16,
            3 => socket.read_u8().await.map_err(|_| "SOCKS5 响应无效")? as usize,
            _ => return Err("SOCKS5 响应无效".into()),
        };
        let mut rest = vec![0; len + 2];
        socket
            .read_exact(&mut rest)
            .await
            .map_err(|_| "SOCKS5 响应无效")?;
    } else {
        let target = authority(host, port);
        socket
            .write_all(
                format!(
                    "CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n{}\r\n",
                    credentials(up)
                )
                .as_bytes(),
            )
            .await
            .map_err(|_| "代理隧道请求失败")?;
        let response = header(&mut *socket).await?;
        let text = String::from_utf8_lossy(&response);
        let status = text
            .lines()
            .next()
            .and_then(|s| s.split_whitespace().nth(1));
        match status {
            Some("200") => {}
            Some("407") => return Err("代理认证失败，请检查用户名和密码".into()),
            _ => return Err("代理拒绝连接目标网站".into()),
        }
    }
    Ok(socket)
}
fn target(value: &str, connect: bool) -> Result<(String, u16, String), String> {
    let url = reqwest::Url::parse(&if connect {
        format!("https://{value}")
    } else {
        value.to_owned()
    })
    .map_err(|_| "代理请求地址无效")?;
    if !["http", "https", "ws", "wss"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("不支持的代理请求".into());
    }
    let host = url
        .host_str()
        .ok_or("代理请求缺少域名")?
        .trim_matches(['[', ']'])
        .to_owned();
    let port = url.port_or_known_default().ok_or("代理请求端口无效")?;
    let route = format!(
        "{}{}",
        url.path(),
        url.query().map(|q| format!("?{q}")).unwrap_or_default()
    );
    Ok((host, port, route))
}
async fn serve(
    mut client: TcpStream,
    up: Arc<Upstream>,
    mut stop: watch::Receiver<bool>,
    failure: Arc<Mutex<Option<String>>>,
) -> Result<(), String> {
    let setup = tokio::time::timeout(Duration::from_secs(20), async {
        let bytes = header(&mut client).await?;
        let text = std::str::from_utf8(&bytes).map_err(|_| "代理请求格式无效")?;
        let mut lines = text.split("\r\n");
        let first = lines.next().ok_or("代理请求为空")?;
        let parts: Vec<_> = first.split_whitespace().collect();
        if parts.len() != 3
            || parts[2] != "HTTP/1.1"
            || !parts[0].bytes().all(|b| b.is_ascii_uppercase())
        {
            return Err("代理请求格式无效".into());
        }
        let connect = parts[0] == "CONNECT";
        let (host, port, route) = target(parts[1], connect)?;
        let mut socket = if connect || up.config.mode == "socks5" {
            tunnel(&up, &host, port).await?
        } else {
            upstream_socket(&up).await?
        };
        if connect {
            client
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .await
                .map_err(|_| "客户端已关闭")?;
        } else {
            let mut request = format!(
                "{} {} HTTP/1.1\r\n",
                parts[0],
                if up.config.mode == "socks5" {
                    route.as_str()
                } else {
                    parts[1]
                }
            );
            let upgrade = text
                .lines()
                .any(|line| line.to_ascii_lowercase().starts_with("upgrade:"));
            for line in lines.filter(|s| !s.is_empty()) {
                let key = line.split(':').next().unwrap_or("").to_ascii_lowercase();
                if ["proxy-authorization", "proxy-connection"].contains(&key.as_str())
                    || (!upgrade && key == "connection")
                {
                    continue;
                }
                if !line.contains(':') || line.starts_with([' ', '\t']) {
                    return Err("代理请求头无效".into());
                }
                request.push_str(line);
                request.push_str("\r\n");
            }
            if up.config.mode != "socks5" {
                request.push_str(&credentials(&up));
            }
            if !upgrade {
                request.push_str("Connection: close\r\n");
            }
            request.push_str("\r\n");
            socket
                .write_all(request.as_bytes())
                .await
                .map_err(|_| "代理请求转发失败")?;
        }
        Ok::<Socket, String>(socket)
    });
    let setup = async {
        setup
            .await
            .unwrap_or_else(|_| Err("代理连接超时，请检查节点".into()))
    };
    let result = tokio::select! {result=setup=>result, _=stop.changed()=>return Ok(())};
    match result {
        Ok(mut socket) => {
            tokio::select! {_=tokio::io::copy_bidirectional(&mut client,&mut socket)=>{},_=stop.changed()=>{}}
            Ok(())
        }
        Err(error) => {
            if let Ok(mut last) = failure.lock() {
                *last = Some(error.clone());
            }
            let body = format!("{error}。当前副本不会自动切换为直连。");
            let _=client.write_all(format!("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await;
            Err(error)
        }
    }
}
pub struct Relay {
    pub port: u16,
    stop: watch::Sender<bool>,
    failure: Arc<Mutex<Option<String>>>,
}
impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}
pub async fn start(up: Upstream, port: u16) -> Result<Relay, String> {
    up.validate()?;
    if !up.config.custom() {
        return Err("本地转发需要自定义代理".into());
    }
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|_| "本地代理端口被占用，请关闭副本后重试")?;
    let port = listener
        .local_addr()
        .map_err(|_| "无法读取本地代理端口")?
        .port();
    let up = Arc::new(up);
    let (stop, mut receiver) = watch::channel(false);
    let connections = receiver.clone();
    let failure = Arc::new(Mutex::new(None));
    let shared_failure = failure.clone();
    tauri::async_runtime::spawn(async move {
        let permits = Arc::new(tokio::sync::Semaphore::new(128));
        loop {
            tokio::select! {
                _=receiver.changed()=>break,
                incoming=listener.accept()=>{if let Ok((socket,_))=incoming {if let Ok(permit)=permits.clone().try_acquire_owned() {let up=up.clone();let stop=connections.clone();let failure=shared_failure.clone();tauri::async_runtime::spawn(async move{let _permit=permit;let _=serve(socket,up,stop,failure).await;});}}else{break;}}
            }
        }
    });
    Ok(Relay {
        port,
        stop,
        failure,
    })
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTest {
    pub ip: Option<String>,
    pub country: Option<String>,
    pub latency: u128,
    pub checked_at: String,
    pub connection: String,
    pub target: String,
}
pub async fn test(up: Upstream) -> Result<ProxyTest, String> {
    up.validate()?;
    let mode = up.config.mode.clone();
    let started = std::time::Instant::now();
    let relay = if up.config.custom() {
        Some(start(up, 0).await?)
    } else {
        None
    };
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(4));
    if let Some(relay) = &relay {
        builder = builder.no_proxy().proxy(
            reqwest::Proxy::all(format!("http://127.0.0.1:{}", relay.port))
                .map_err(|_| "无法准备代理测试")?,
        );
    } else if mode == "direct" {
        builder = builder.no_proxy();
    }
    let client = builder.build().map_err(|_| "无法准备网络检测")?;
    let result = client
        .get("https://www.cloudflare.com/cdn-cgi/trace")
        .send()
        .await
        .map_err(|_| {
            relay
                .as_ref()
                .and_then(|r| r.failure.lock().ok().and_then(|v| v.clone()))
                .unwrap_or_else(|| "代理连接或认证失败，请检查地址、密码及网络".into())
        })?;
    if !result.status().is_success() {
        return Err("出口检测服务暂时不可用，请重试".into());
    }
    let text = result.text().await.map_err(|_| "无法读取出口检测结果")?;
    let value = |key: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(key))
            .map(str::to_owned)
    };
    let latency = started.elapsed().as_millis();
    let target = match client.get("https://claude.ai").send().await {
        Ok(response) => format!("claude.ai HTTP {}", response.status().as_u16()),
        Err(_) => "出口检测成功；Claude 连接超时或失败".into(),
    };
    Ok(ProxyTest {
        ip: value("ip="),
        country: value("loc="),
        latency,
        checked_at: chrono::Utc::now().to_rfc3339(),
        connection: if mode == "system" {
            "应用按系统 / 环境代理检测；PAC、分流和浏览器策略可能不同，请在副本内复检".into()
        } else {
            "通过副本指定代理路径检测；实际浏览器出口请在副本内复检".into()
        },
        target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Starts two real Chrome windows in temporary profiles; run explicitly for release QA"]
    async fn real_browser_profiles_keep_cookies_proxies_and_close_actions_separate() {
        use crate::{platform, profiles};
        let root = tempfile::tempdir().unwrap();
        struct Cleanup(Vec<std::path::PathBuf>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for path in &self.0 {
                    let _ = platform::close_profile(path);
                }
            }
        }
        async fn mock_proxy(
            label: &'static str,
        ) -> (
            u16,
            tokio::sync::oneshot::Receiver<String>,
            tokio::task::JoinHandle<()>,
        ) {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let (tx, rx) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(async move {
                let mut sender = Some(tx);
                loop {
                    let (mut s, _) = listener.accept().await.unwrap();
                    let req = match header(&mut s).await {
                        Ok(b) => String::from_utf8_lossy(&b).to_string(),
                        Err(_) => continue,
                    };
                    if !req.starts_with("GET http://127.0.0.1:7777/") {
                        let _=s.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                        continue;
                    }
                    assert!(req.contains("Proxy-Authorization: Basic dXNlcjpzZWNyZXQ="));
                    if req.starts_with("GET http://127.0.0.1:7777/probe") {
                        if let Some(tx) = sender.take() {
                            let _ = tx.send(req.clone());
                        }
                    }
                    let body = if req.contains("/session HTTP") {
                        "<!doctype html><title>Claude Done release QA</title><p>Temporary browser isolation test</p><script>fetch('/probe')</script>"
                    } else {
                        "ok"
                    };
                    let cookie = if req.contains("/session HTTP") {
                        format!("Set-Cookie: session={label}; Path=/; SameSite=Lax\r\n")
                    } else {
                        String::new()
                    };
                    let _=s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{cookie}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await;
                }
            });
            (port, rx, task)
        }
        let draft = |name: &str| profiles::Draft {
            name: name.into(),
            browser: "chrome".into(),
            notes: String::new(),
            tags: vec![],
            proxy: ProxyConfig::system(),
            password: None,
            clear_password: false,
            preferences: profiles::Preferences::default(),
        };
        let one = profiles::create(root.path(), draft("QA one"), None).unwrap();
        let two = profiles::create(root.path(), draft("QA two"), None).unwrap();
        let path_one = profiles::path(root.path(), &one).unwrap();
        let path_two = profiles::path(root.path(), &two).unwrap();
        let _cleanup = Cleanup(vec![path_one.clone(), path_two.clone()]);
        let (a, rx_a, server_a) = mock_proxy("one").await;
        let (b, rx_b, server_b) = mock_proxy("two").await;
        let relay_a = start(up("http", a), 0).await.unwrap();
        let relay_b = start(up("http", b), 0).await.unwrap();
        platform::spawn_browser_with_proxy(
            "chrome",
            &path_one,
            "http://127.0.0.1:7777/session",
            "http",
            Some(relay_a.port),
        )
        .unwrap();
        platform::spawn_browser_with_proxy(
            "chrome",
            &path_two,
            "http://127.0.0.1:7777/session",
            "http",
            Some(relay_b.port),
        )
        .unwrap();
        let request_a = tokio::time::timeout(Duration::from_secs(45), rx_a)
            .await
            .unwrap()
            .unwrap();
        let request_b = tokio::time::timeout(Duration::from_secs(45), rx_b)
            .await
            .unwrap()
            .unwrap();
        assert!(request_a.contains("session=one"));
        assert!(!request_a.contains("session=two"));
        assert!(request_b.contains("session=two"));
        assert!(!request_b.contains("session=one"));
        assert!(profiles::running(root.path(), &one).unwrap());
        assert!(profiles::running(root.path(), &two).unwrap());
        platform::close_profile(&path_one).unwrap();
        assert!(!profiles::running(root.path(), &one).unwrap());
        assert!(profiles::running(root.path(), &two).unwrap());
        platform::close_profile(&path_two).unwrap();
        assert!(!profiles::running(root.path(), &two).unwrap());
        server_a.abort();
        server_b.abort();
    }
    #[tokio::test]
    async fn https_proxy_rejects_plaintext_before_credentials_are_sent() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut bytes = [0u8; 4096];
            let len = s.read(&mut bytes).await.unwrap();
            assert_eq!(bytes[0], 22);
            assert!(!String::from_utf8_lossy(&bytes[..len]).contains("secret"));
            s.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
        });
        assert!(upstream_socket(&up("https", port))
            .await
            .err()
            .unwrap()
            .contains("TLS"));
        server.await.unwrap();
    }
    #[tokio::test]
    async fn rejected_authentication_is_explained_and_never_connects_directly() {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_port = destination.local_addr().unwrap().port();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            header(&mut s).await.unwrap();
            s.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                .await
                .unwrap();
        });
        let relay = start(up("http", port), 0).await.unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", relay.port)).await.unwrap();
        client
            .write_all(
                format!("CONNECT 127.0.0.1:{target_port} HTTP/1.1\r\nHost: localhost\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
        assert!(header(&mut client)
            .await
            .unwrap()
            .starts_with(b"HTTP/1.1 502"));
        assert!(relay
            .failure
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .contains("认证"));
        assert!(
            tokio::time::timeout(Duration::from_millis(250), destination.accept())
                .await
                .is_err()
        );
        server.await.unwrap();
    }
    #[tokio::test]
    async fn plain_http_upstream_auth_replaces_client_auth_and_profiles_route_separately() {
        async fn endpoint(label: &'static str) -> (u16, tokio::task::JoinHandle<()>) {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let task = tokio::spawn(async move {
                let (mut s, _) = listener.accept().await.unwrap();
                let req = String::from_utf8(header(&mut s).await.unwrap()).unwrap();
                assert!(req.starts_with("GET http://example.com/test HTTP/1.1"));
                assert!(req.contains("Proxy-Authorization: Basic dXNlcjpzZWNyZXQ="));
                assert!(!req.contains("client-secret"));
                s.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{label}",
                        label.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            });
            (port, task)
        }
        let (a, task_a) = endpoint("profile-a").await;
        let (b, task_b) = endpoint("profile-b").await;
        let relay_a = start(up("http", a), 0).await.unwrap();
        let relay_b = start(up("http", b), 0).await.unwrap();
        assert_ne!(relay_a.port, relay_b.port);
        async fn request(port: u16) -> String {
            let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(b"GET http://example.com/test HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: client-secret\r\n\r\n").await.unwrap();
            let mut bytes = vec![];
            s.read_to_end(&mut bytes).await.unwrap();
            String::from_utf8(bytes).unwrap()
        }
        let (ra, rb) = tokio::join!(request(relay_a.port), request(relay_b.port));
        assert!(ra.ends_with("profile-a"));
        assert!(rb.ends_with("profile-b"));
        task_a.await.unwrap();
        task_b.await.unwrap();
    }
    #[tokio::test]
    async fn dropping_relay_cancels_a_stalled_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let relay = start(up("http", port), 0).await.unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", relay.port)).await.unwrap();
        client
            .write_all(b"CONNECT example.com:443 HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let (mut upstream, _) = listener.accept().await.unwrap();
        header(&mut upstream).await.unwrap();
        drop(relay);
        let mut bytes = [0; 1];
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), client.read(&mut bytes))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    }
    fn up(mode: &str, port: u16) -> Upstream {
        Upstream {
            config: ProxyConfig {
                mode: mode.into(),
                host: "127.0.0.1".into(),
                port,
                username: "user".into(),
                ..ProxyConfig::default()
            },
            password: "secret".into(),
        }
    }
    #[test]
    fn validates_proxy_and_target_without_accepting_injected_headers() {
        let mut p = up("http", 80);
        assert!(p.validate().is_ok());
        p.config.host = "host\r\nX:evil".into();
        assert!(p.validate().is_err());
        assert!(target("file:///tmp/a", false).is_err());
        assert_eq!(target("[::1]:443", true).unwrap().1, 443);
    }
    #[tokio::test]
    async fn http_authentication_and_tunnel_bytes_work() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = String::from_utf8(header(&mut socket).await.unwrap()).unwrap();
            assert!(request.starts_with("CONNECT example.com:443"));
            assert!(request.contains("Proxy-Authorization: Basic dXNlcjpzZWNyZXQ="));
            socket.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
            let mut data = [0; 4];
            socket.read_exact(&mut data).await.unwrap();
            socket.write_all(&data).await.unwrap();
        });
        let mut socket = tunnel(&up("http", port), "example.com", 443).await.unwrap();
        socket.write_all(b"ping").await.unwrap();
        let mut data = [0; 4];
        socket.read_exact(&mut data).await.unwrap();
        assert_eq!(&data, b"ping");
        server.await.unwrap();
    }
    #[tokio::test]
    async fn socks_auth_and_remote_domain_resolution_work() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut greeting = [0; 3];
            socket.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [5, 1, 2]);
            socket.write_all(&[5, 2]).await.unwrap();
            assert_eq!(socket.read_u8().await.unwrap(), 1);
            let len = socket.read_u8().await.unwrap();
            let mut user = vec![0; len as usize];
            socket.read_exact(&mut user).await.unwrap();
            assert_eq!(user, b"user");
            let len = socket.read_u8().await.unwrap();
            let mut password = vec![0; len as usize];
            socket.read_exact(&mut password).await.unwrap();
            assert_eq!(password, b"secret");
            socket.write_all(&[1, 0]).await.unwrap();
            let mut request = [0; 5];
            socket.read_exact(&mut request).await.unwrap();
            assert_eq!(&request[..4], &[5, 1, 0, 3]);
            let mut domain = vec![0; request[4] as usize];
            socket.read_exact(&mut domain).await.unwrap();
            assert_eq!(domain, b"example.com");
            assert_eq!(socket.read_u16().await.unwrap(), 443);
            socket
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 1])
                .await
                .unwrap();
        });
        tunnel(&up("socks5", port), "example.com", 443)
            .await
            .unwrap();
        server.await.unwrap();
    }
    #[tokio::test]
    async fn relay_fails_closed_when_upstream_is_down() {
        let relay = start(up("http", 1), 0).await.unwrap();
        let mut socket = TcpStream::connect(("127.0.0.1", relay.port)).await.unwrap();
        socket
            .write_all(b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n")
            .await
            .unwrap();
        let reply = header(&mut socket).await.unwrap();
        assert!(reply.starts_with(b"HTTP/1.1 502"));
    }
}
