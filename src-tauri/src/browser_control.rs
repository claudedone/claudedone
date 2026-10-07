//! Native, loopback-only browser emulation. No page-level Date/Intl hooks.
use crate::{
    platform,
    profiles::PermissionMode,
    regional::{self, ResolvedRegion},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    net::TcpStream,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};

#[derive(Default)]
pub struct Runtime(Mutex<HashMap<String, Control>>);
impl Runtime {
    pub fn ready(&self, id: &str) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|m| m.get(id).map(|c| c.alive.load(Ordering::SeqCst)))
            .unwrap_or(false)
    }
    pub fn error(&self, id: &str) -> Option<String> {
        self.0.lock().ok().and_then(|m| {
            m.get(id)
                .and_then(|c| c.error.lock().ok().and_then(|e| e.clone()))
        })
    }
    pub fn stop(&self, id: &str) {
        if let Ok(mut m) = self.0.lock() {
            m.remove(id);
        }
    }
    pub fn clear(&self) {
        if let Ok(mut m) = self.0.lock() {
            m.clear();
        }
    }
    pub fn insert(&self, id: String, control: Control) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "区域设置控制器不可用")?
            .insert(id, control);
        Ok(())
    }
    pub fn open(&self, id: &str, url: String, new_tab: bool) -> Result<(), String> {
        let m = self.0.lock().map_err(|_| "区域设置控制器不可用")?;
        m.get(id)
            .ok_or("此副本区域设置尚未连接，请关闭并重新启动")?
            .open(url, new_tab)
    }
}
enum Request {
    Open(String, bool, mpsc::Sender<Result<(), String>>),
    #[cfg(test)]
    Probe(mpsc::Sender<Result<Value, String>>),
}
pub struct Control {
    sender: mpsc::Sender<Request>,
    stop: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Drop for Control {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
impl Control {
    fn open(&self, url: String, new_tab: bool) -> Result<(), String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err("区域控制连接已中断，请重启副本".into());
        }
        let (tx, rx) = mpsc::channel();
        self.sender
            .send(Request::Open(url, new_tab, tx))
            .map_err(|_| "区域控制连接已中断")?;
        rx.recv_timeout(Duration::from_secs(20))
            .map_err(|_| "浏览器页面打开超时")?
    }
}
struct Protocol {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    next: u64,
    events: VecDeque<Value>,
    last_error: Option<String>,
}
impl Protocol {
    fn read(&mut self) -> Result<Option<Value>, String> {
        match self.socket.read() {
            Ok(Message::Text(text)) => serde_json::from_str(&text)
                .map(Some)
                .map_err(|_| "浏览器控制响应格式无效".into()),
            Ok(Message::Close(_)) => Err("浏览器区域控制连接已关闭".into()),
            Ok(_) => Ok(None),
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                Ok(None)
            }
            Err(_) => Err("浏览器区域控制连接中断".into()),
        }
    }
    // UI activation can wait indefinitely for OS visibility in Firefox background windows.
    // It is independent of the acknowledged region settings and navigation commands.
    fn activate(&mut self, context: &str) -> Result<(), String> {
        self.next += 1;
        self.socket.send(Message::Text(json!({"id":self.next,"method":"browsingContext.activate","params":{"context":context}}).to_string().into())).map_err(|_|"无法切换浏览器标签页".into())
    }
    fn call(
        &mut self,
        method: &str,
        params: Value,
        session: Option<&str>,
    ) -> Result<Value, String> {
        self.last_error = None;
        self.next += 1;
        let id = self.next;
        let mut message = json!({"id":id,"method":method,"params":params});
        if let Some(s) = session {
            message["sessionId"] = json!(s)
        }
        self.socket
            .send(Message::Text(message.to_string().into()))
            .map_err(|_| "无法写入浏览器区域设置")?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(15) {
            if let Some(value) = self.read()? {
                if value["id"] == id {
                    if value.get("error").is_some() {
                        self.last_error = value["error"]["message"].as_str().map(str::to_owned);
                        return Err(format!(
                            "浏览器不支持或拒绝了区域设置 {method}，请更新浏览器后重试"
                        ));
                    }
                    if value["type"] == "exception"
                        || value["result"]["type"] == "exception"
                        || value["result"].get("exceptionDetails").is_some()
                    {
                        return Err("浏览器区域匹配执行失败".into());
                    }
                    return Ok(value["result"].clone());
                }
                if value.get("id").is_none() {
                    self.events.push_back(value);
                }
                if self.events.len() > 4096 {
                    return Err("浏览器控制事件过多".into());
                }
            }
        }
        Err(format!("浏览器区域设置 {method} 超时"))
    }
}
fn endpoint(browser: &str, path: &Path) -> Result<String, String> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        let endpoint = if browser == "firefox" {
            std::fs::read(path.join("WebDriverBiDiServer.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| {
                    let host = v["ws_host"].as_str()?;
                    if !["127.0.0.1", "localhost", "::1"].contains(&host) {
                        return None;
                    }
                    let port = v["ws_port"].as_u64().filter(|p| *p > 0 && *p <= 65535)?;
                    Some(format!("ws://127.0.0.1:{port}/session"))
                })
        } else {
            std::fs::read_to_string(path.join("DevToolsActivePort"))
                .ok()
                .and_then(|text| {
                    let mut lines = text.lines();
                    let port = lines.next()?.parse::<u16>().ok().filter(|p| *p > 0)?;
                    let route = lines.next()?.strip_prefix("/devtools/browser/")?;
                    if route.is_empty()
                        || !route
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    {
                        return None;
                    }
                    Some(format!("ws://127.0.0.1:{port}/devtools/browser/{route}"))
                })
        };
        if let Some(url) = endpoint {
            return Ok(url);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("无法连接此副本的本地区域控制接口；请更新浏览器并重新启动".into())
}
struct BrowserControl {
    protocol: Protocol,
    firefox: bool,
    region: ResolvedRegion,
    permission: PermissionMode,
    primary: String,
    sessions: HashSet<String>,
    targets: HashMap<String, String>,
    workers: HashSet<String>,
}
impl BrowserControl {
    fn initialize(
        browser: &str,
        path: &Path,
        region: ResolvedRegion,
        permission: PermissionMode,
        match_ip: bool,
        lookup_url: &str,
    ) -> Result<Self, String> {
        let (mut socket, _) = tungstenite::connect(endpoint(browser, path)?.as_str())
            .map_err(|_| "无法连接此副本的本地浏览器接口")?;
        if let MaybeTlsStream::Plain(stream) = socket.get_mut() {
            stream
                .set_read_timeout(Some(Duration::from_millis(100)))
                .map_err(|_| "无法设置控制超时")?;
            stream
                .set_write_timeout(Some(Duration::from_secs(3)))
                .map_err(|_| "无法设置控制超时")?;
        }
        let mut this = Self {
            protocol: Protocol {
                socket,
                next: 0,
                events: VecDeque::new(),
                last_error: None,
            },
            firefox: browser == "firefox",
            region,
            permission,
            primary: String::new(),
            sessions: HashSet::new(),
            targets: HashMap::new(),
            workers: HashSet::new(),
        };
        if this.firefox {
            this.protocol.call(
                "session.new",
                json!({"capabilities":{"alwaysMatch":{"acceptInsecureCerts":false}}}),
                None,
            )?;
            let tree =
                this.protocol
                    .call("browsingContext.getTree", json!({"maxDepth":0}), None)?;
            this.primary = tree["contexts"][0]["context"]
                .as_str()
                .ok_or("Firefox 初始页面尚未就绪")?
                .into();
        } else {
            this.protocol.call("Target.setAutoAttach",json!({"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true,"filter":[{"type":"page","exclude":false},{"type":"iframe","exclude":false},{"type":"worker","exclude":false},{"type":"shared_worker","exclude":false},{"type":"service_worker","exclude":false},{"exclude":true}]}),None)?;
            this.drain()?;
            if this.primary.is_empty() {
                return Err("Chrome / Edge 初始页面尚未就绪".into());
            }
        }
        if match_ip {
            // Query inside the actual browser so PAC/TUN/extension routing is respected.
            let expression=format!("fetch({},{{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)}}).then(async r=>{{if(!r.ok)throw Error('region unavailable');const t=await r.text();if(t.length>65536)throw Error('region too large');return t}})",json!(lookup_url));
            let result = if this.firefox {
                this.protocol.call("script.evaluate",json!({"expression":expression,"target":{"context":this.primary},"awaitPromise":true}),None)?["result"]["value"].clone()
            } else {
                this.protocol.call(
                    "Runtime.evaluate",
                    json!({"expression":expression,"awaitPromise":true,"returnByValue":true}),
                    Some(&this.primary),
                )?["result"]["value"]
                    .clone()
            };
            let data: Value = serde_json::from_str(
                result
                    .as_str()
                    .ok_or("无法在副本浏览器内匹配 IP 区域，请检查代理或使用自定义设置")?,
            )
            .map_err(|_| "浏览器 IP 区域响应无效")?;
            this.region.ip_region = Some(regional::parse_ip_region(&data)?);
        }
        Ok(this)
    }
    fn apply(&mut self, session: Option<&str>) -> Result<(), String> {
        let locale = self.region.language.split(',').next().unwrap_or("en-US");
        if self.firefox {
            self.protocol.call(
                "emulation.setLocaleOverride",
                json!({"locale":locale,"userContexts":["default"]}),
                None,
            )?;
            if let Some(timezone) = &self.region.timezone {
                self.protocol.call(
                    "emulation.setTimezoneOverride",
                    json!({"timezone":timezone,"userContexts":["default"]}),
                    None,
                )?;
            }
            if let (Some(latitude), Some(longitude)) = (self.region.latitude, self.region.longitude)
            {
                self.protocol.call("emulation.setGeolocationOverride",json!({"coordinates":{"latitude":latitude,"longitude":longitude,"accuracy":self.region.accuracy},"userContexts":["default"]}),None)?;
            }
        } else {
            let worker = session.map(|s| self.workers.contains(s)).unwrap_or(false);
            let current=match self.protocol.call("Runtime.evaluate",json!({"expression":"Intl.DateTimeFormat().resolvedOptions()","returnByValue":true}),session) {Ok(result)=>result["result"]["value"].clone(),Err(_) if self.protocol.last_error.as_deref()==Some("Cannot find default execution context")=>Value::Null,Err(e)=>return Err(e)};
            if current["locale"] != locale {
                if let Err(error) = self.protocol.call(
                    "Emulation.setLocaleOverride",
                    json!({"locale":locale}),
                    session,
                ) {
                    // Chromium shares Intl overrides with same-process frames. A newly paused
                    // iframe may not have an execution context yet; its parent owns this override.
                    if self.protocol.last_error.as_deref()
                        != Some("Another locale override is already in effect")
                    {
                        return Err(error);
                    }
                }
            }
            if let Some(timezone) = &self.region.timezone {
                if current["timeZone"] != *timezone {
                    if let Err(error) = self.protocol.call(
                        "Emulation.setTimezoneOverride",
                        json!({"timezoneId":timezone}),
                        session,
                    ) {
                        if self
                            .protocol
                            .last_error
                            .as_deref()
                            .map(|e| e.trim_end_matches('.'))
                            != Some("Timezone override is already in effect")
                        {
                            return Err(error);
                        }
                    }
                }
            }
            if let (Some(latitude), Some(longitude)) = (
                self.region.latitude.filter(|_| !worker),
                self.region.longitude,
            ) {
                self.protocol.call("Emulation.setGeolocationOverride",json!({"latitude":latitude,"longitude":longitude,"accuracy":self.region.accuracy}),session)?;
            }
        }
        Ok(())
    }
    fn configure(&mut self) -> Result<(), String> {
        if self.firefox {
            self.apply(None)
        } else {
            self.protocol.call("Browser.setPermission",json!({"permission":{"name":"geolocation"},"setting":match self.permission{PermissionMode::Allow=>"granted",PermissionMode::Block=>"denied",_=>"prompt"}}),None)?;
            for session in self.sessions.clone() {
                self.apply(Some(&session))?;
            }
            Ok(())
        }
    }
    fn drain(&mut self) -> Result<(), String> {
        while let Some(event) = self.protocol.events.pop_front() {
            if event["method"] == "Target.attachedToTarget" {
                let params = &event["params"];
                let session = params["sessionId"]
                    .as_str()
                    .ok_or("浏览器附加页面无效")?
                    .to_owned();
                if let Some(target) = params["targetInfo"]["targetId"].as_str() {
                    self.targets.insert(target.into(), session.clone());
                }
                if !["page", "iframe"]
                    .contains(&params["targetInfo"]["type"].as_str().unwrap_or(""))
                {
                    self.workers.insert(session.clone());
                }
                if self.sessions.insert(session.clone()) {
                    if self.primary.is_empty() && params["targetInfo"]["type"] == "page" {
                        self.primary = session.clone();
                    }
                    self.apply(Some(&session))?;
                    self.protocol.call("Target.setAutoAttach",json!({"autoAttach":true,"waitForDebuggerOnStart":true,"flatten":true,"filter":[{"type":"iframe","exclude":false},{"type":"worker","exclude":false},{"type":"shared_worker","exclude":false},{"type":"service_worker","exclude":false},{"exclude":true}]}),Some(&session))?;
                    self.protocol.call(
                        "Runtime.runIfWaitingForDebugger",
                        json!({}),
                        Some(&session),
                    )?;
                }
            } else if event["method"] == "Target.detachedFromTarget" {
                if let Some(session) = event["params"]["sessionId"].as_str() {
                    self.sessions.remove(session);
                    self.workers.remove(session);
                    self.targets.retain(|_, attached| attached != session);
                }
            }
        }
        Ok(())
    }
    fn open(&mut self, url: &str, new_tab: bool) -> Result<(), String> {
        if self.firefox {
            let context = if new_tab {
                self.protocol.call(
                    "browsingContext.create",
                    json!({"type":"tab","referenceContext":self.primary,"background":true}),
                    None,
                )?["context"]
                    .as_str()
                    .ok_or("无法创建 Firefox 页面")?
                    .to_owned()
            } else {
                self.primary.clone()
            };
            if let Ok(parsed) = reqwest::Url::parse(url) {
                if ["http", "https"].contains(&parsed.scheme()) {
                    self.protocol.call("permissions.setPermission",json!({"descriptor":{"name":"geolocation"},"state":match self.permission{PermissionMode::Allow=>"granted",PermissionMode::Block=>"denied",_=>"prompt"},"origin":parsed.origin().ascii_serialization(),"userContext":"default"}),None)?;
                }
            }
            self.protocol.call(
                "browsingContext.navigate",
                json!({"context":context,"url":url,"wait":"none"}),
                None,
            )?;
            if new_tab {
                self.protocol.activate(&context)?;
            }
        } else {
            let session = if new_tab {
                let target = self.protocol.call(
                    "Target.createTarget",
                    json!({"url":"about:blank"}),
                    None,
                )?["targetId"]
                    .as_str()
                    .ok_or("无法创建浏览器页面")?
                    .to_owned();
                let started = Instant::now();
                loop {
                    self.drain()?;
                    if let Some(session) = self.targets.get(&target) {
                        break session.clone();
                    }
                    if started.elapsed() > Duration::from_secs(5) {
                        return Err("新标签页的区域设置未就绪".into());
                    }
                    if let Some(event) = self.protocol.read()? {
                        self.protocol.events.push_back(event)
                    }
                }
            } else {
                self.primary.clone()
            };
            self.protocol
                .call("Page.navigate", json!({"url":url}), Some(&session))?;
        }
        Ok(())
    }
}
pub fn start(
    browser: String,
    path: PathBuf,
    preferences: crate::profiles::Preferences,
    initial: ResolvedRegion,
) -> Result<(Control, ResolvedRegion), String> {
    start_with_lookup(
        browser,
        path,
        preferences,
        initial,
        regional::LOOKUP_URL.to_owned(),
    )
}
fn start_with_lookup(
    browser: String,
    path: PathBuf,
    preferences: crate::profiles::Preferences,
    initial: ResolvedRegion,
    lookup_url: String,
) -> Result<(Control, ResolvedRegion), String> {
    let (sender, requests) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let alive = Arc::new(AtomicBool::new(false));
    let error = Arc::new(Mutex::new(None));
    let mut control = Control {
        sender,
        stop: stop.clone(),
        alive: alive.clone(),
        error: error.clone(),
        worker: None,
    };
    let worker = std::thread::spawn(move || {
        let boot = BrowserControl::initialize(
            &browser,
            &path,
            initial,
            preferences.advanced.location.clone(),
            regional::uses_ip(&preferences),
            &lookup_url,
        )
        .and_then(|mut state| {
            state.region = regional::resolve(&preferences, state.region.ip_region.clone())?;
            state.configure()?;
            state.drain()?;
            Ok(state)
        });
        let mut state = match boot {
            Ok(state) => state,
            Err(e) => {
                let _ = ready_tx.send(Err(e));
                return;
            }
        };
        alive.store(true, Ordering::SeqCst);
        if ready_tx.send(Ok(state.region.clone())).is_err() {
            return;
        }
        let run = (|| -> Result<(), String> {
            while !stop.load(Ordering::SeqCst) {
                if let Ok(request) = requests.try_recv() {
                    match request {
                        Request::Open(url, new_tab, response) => {
                            let result = state.open(&url, new_tab);
                            let failed = result.clone().err();
                            let _ = response.send(result);
                            if let Some(error) = failed {
                                return Err(error);
                            }
                        }
                        #[cfg(test)]
                        Request::Probe(response) => {
                            let _=response.send(state.protocol.call("Runtime.evaluate",json!({"expression":"({url:location.href,ready:document.readyState,body:document.body.innerText,first:typeof first!=='undefined'?first:null,progress:window.progress})","returnByValue":true}),Some(&state.primary)));
                        }
                    }
                }
                state.drain()?;
                if let Some(event) = state.protocol.read()? {
                    state.protocol.events.push_back(event)
                }
            }
            Ok(())
        })();
        alive.store(false, Ordering::SeqCst);
        if let Err(message) = run {
            if !stop.load(Ordering::SeqCst)
                && platform::profile_process_ids(&path)
                    .map(|pids| !pids.is_empty())
                    .unwrap_or(true)
            {
                if let Ok(mut e) = error.lock() {
                    *e = Some(format!("{message}；已关闭此副本，请重新启动"));
                }
                let _ = platform::close_profile(&path);
            }
        }
    });
    control.worker = Some(worker);
    let region = ready_rx
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| "区域设置准备超时")??;
    Ok((control, region))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        profiles::{self, Draft, Preferences},
        proxy::ProxyConfig,
    };
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    struct Fixture {
        port: u16,
        reports: mpsc::Receiver<Value>,
        stop: Arc<AtomicBool>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
        }
    }
    impl Fixture {
        fn new() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            let (tx, reports) = mpsc::channel();
            std::thread::spawn(move || {
                while !stopping.load(Ordering::SeqCst) {
                    let Ok((mut stream, _)) = listener.accept() else {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    };
                    let tx = tx.clone();
                    std::thread::spawn(move || {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(3)))
                            .unwrap();
                        let mut bytes = Vec::new();
                        loop {
                            let mut chunk = [0; 2048];
                            let Ok(n) = stream.read(&mut chunk) else {
                                break;
                            };
                            if n == 0 {
                                break;
                            }
                            bytes.extend_from_slice(&chunk[..n]);
                            if bytes.windows(4).any(|w| w == b"\r\n\r\n") || bytes.len() > 16384 {
                                break;
                            }
                        }
                        let request = String::from_utf8_lossy(&bytes);
                        let route = request
                            .lines()
                            .next()
                            .unwrap_or("")
                            .split_whitespace()
                            .nth(1)
                            .unwrap_or("/");

                        let normalized = reqwest::Url::parse(route).ok().map(|url| {
                            format!(
                                "{}{}",
                                url.path(),
                                url.query().map(|q| format!("?{q}")).unwrap_or_default()
                            )
                        });
                        let route = normalized.as_deref().unwrap_or(route);
                        let (kind, body) = if route.starts_with("/region") {
                            ("application/json",json!({"success":true,"ip":"203.0.113.12","country_code":"JP","city":"Tokyo","latitude":35.68,"longitude":139.69,"timezone":{"id":"Asia/Tokyo"}}).to_string())
                        } else if route.starts_with("/report?") {
                            let url =
                                reqwest::Url::parse(&format!("http://localhost{route}")).unwrap();
                            let raw = url
                                .query_pairs()
                                .find(|(k, _)| k == "data")
                                .unwrap()
                                .1
                                .into_owned();
                            let mut data: Value = serde_json::from_str(&raw).unwrap();
                            data["header"] = json!(request
                                .lines()
                                .find_map(|l| l
                                    .strip_prefix("Accept-Language: ")
                                    .or_else(|| l.strip_prefix("accept-language: ")))
                                .unwrap_or(""));
                            let _ = tx.send(data);
                            ("text/plain", "ok".into())
                        } else if route.starts_with("/frame") {
                            ("text/html",r#"<script>parent.postMessage({frame:{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,jan:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),jul:new Date('2026-07-15T12:00:00Z').getTimezoneOffset()}},'*')</script>"#.into())
                        } else {
                            ("text/html",r#"<!doctype html><title>NodeCloak region verification</title><p>Verifying isolated browser settings</p><script>
                    const snapshot=()=>({webdriver:navigator.webdriver,language:navigator.language,languages:[...navigator.languages],locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,jan:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),jul:new Date('2026-07-15T12:00:00Z').getTimezoneOffset()});
                    const first=snapshot();first.tag=location.pathname;window.progress={};
                    const worker=new Promise(resolve=>{const w=new Worker(URL.createObjectURL(new Blob(['postMessage(('+snapshot.toString()+')())'],{type:'application/javascript'})));w.onmessage=e=>{w.terminate();window.progress.worker=e.data;resolve(e.data)};w.onerror=e=>resolve({error:e.message});setTimeout(()=>resolve({error:'timeout'}),5000)});
                    const frame=new Promise(resolve=>{addEventListener('message',e=>{if(e.data.frame){window.progress.frame=e.data.frame;resolve(e.data.frame)}});const f=document.createElement('iframe');f.src=location.origin.replace('127.0.0.1','localhost')+'/frame';document.documentElement.append(f);setTimeout(()=>resolve({error:'timeout'}),5000)});
                    const geo=new Promise(resolve=>navigator.geolocation.getCurrentPosition(p=>{window.progress.geo='success';resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy})},e=>{window.progress.geo='error '+e.code;resolve({error:e.code})},{timeout:5000}));const permission=navigator.permissions.query({name:'geolocation'}).then(p=>{window.progress.permission=p.state;return p});setTimeout(()=>window.progress.timer='fired',6000);
                    Promise.all([worker,frame,geo,permission]).then(([worker,frame,geo,permission])=>fetch('/report?data='+encodeURIComponent(JSON.stringify({...first,worker,frame,geo,permission:permission.state})))).catch(e=>fetch('/report?data='+encodeURIComponent(JSON.stringify({error:String(e)}))));
                    </script>"#.into())
                        };
                        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nCache-Control: no-store\r\n\r\n{body}",body.len());
                        let _ = stream.write_all(response.as_bytes());
                    });
                }
            });
            Self {
                port,
                reports,
                stop,
            }
        }
        fn url(&self, route: &str) -> String {
            format!("http://127.0.0.1:{}{route}", self.port)
        }
        fn report(&self, browser: &TempBrowser) -> Value {
            match self.reports.recv_timeout(Duration::from_secs(20)) {
                Ok(data) => data,
                Err(e) => {
                    let (tx, rx) = mpsc::channel();
                    let _ = browser.control.sender.send(Request::Probe(tx));
                    panic!(
                        "browser did not report {e:?}; probe {:?}; controller {:?}",
                        rx.recv_timeout(Duration::from_secs(5)),
                        browser.control.error.lock().unwrap()
                    );
                }
            }
        }
    }
    struct TempBrowser {
        path: PathBuf,
        control: Control,
        _root: tempfile::TempDir,
    }
    impl Drop for TempBrowser {
        fn drop(&mut self) {
            self.control.stop.store(true, Ordering::SeqCst);
            let _ = platform::close_profile(&self.path);
        }
    }
    fn browser(browser: &str, prefs: Preferences, lookup: &str) -> TempBrowser {
        let root = tempfile::tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let draft = Draft {
            name: "Region verification".into(),
            browser: browser.into(),
            notes: String::new(),
            tags: vec![],
            proxy: ProxyConfig {
                mode: "direct".into(),
                ..ProxyConfig::default()
            },
            password: None,
            clear_password: false,
            preferences: prefs.clone(),
        };
        let p = profiles::create(&canonical, draft, None).unwrap();
        let path = profiles::path(&canonical, &p).unwrap();
        let ip=regional::uses_ip(&prefs).then(||regional::parse_ip_region(&json!({"success":true,"ip":"203.0.113.12","country_code":"JP","city":"Tokyo","latitude":35.68,"longitude":139.69,"timezone":{"id":"Asia/Tokyo"}})).unwrap());
        platform::spawn_controlled_browser(browser, &path, "direct", None).unwrap();
        let result = start_with_lookup(
            browser.into(),
            path.clone(),
            prefs.clone(),
            regional::resolve(&prefs, ip).unwrap(),
            lookup.into(),
        );
        if result.is_err() {
            platform::close_profile(&path).unwrap();
        }
        let (control, _) = result.unwrap();
        TempBrowser {
            path,
            control,
            _root: root,
        }
    }
    fn check(
        data: &Value,
        language: &str,
        zone: &str,
        jan: i64,
        jul: i64,
        latitude: f64,
        longitude: f64,
    ) {
        assert_eq!(data["language"], language, "first document language {data}");
        assert_eq!(data["locale"], language, "Intl locale {data}");
        assert!(
            data["header"].as_str().unwrap().starts_with(language),
            "Accept-Language {data}"
        );
        for context in [data, &data["worker"], &data["frame"]] {
            assert_eq!(context["timezone"], zone, "timezone {data}");
            assert_eq!(context["jan"], jan, "winter offset {data}");
            assert_eq!(context["jul"], jul, "summer offset {data}");
        }
        assert_eq!(data["permission"], "granted", "permission {data}");
        assert!(
            (data["geo"]["latitude"].as_f64().unwrap() - latitude).abs() < 0.000001,
            "geo {data}"
        );
        assert!(
            (data["geo"]["longitude"].as_f64().unwrap() - longitude).abs() < 0.000001,
            "geo {data}"
        );
    }
    #[test]
    #[ignore = "Starts temporary installed browsers and verifies custom/IP regions, new tabs, worker/iframe offsets and simultaneous profile isolation"]
    fn native_regions_are_observed_in_real_browsers() {
        let fixture = Fixture::new();
        for engine in ["chrome", "edge", "firefox"].into_iter().filter(|name| {
            std::env::var("CLAUDE_DONE_TEST_BROWSER")
                .map(|selected| selected == *name)
                .unwrap_or(true)
        }) {
            let mut prefs = Preferences::default();
            prefs.language = "de-DE,de,en".into();
            prefs.regional.timezone_mode = "custom".into();
            prefs.regional.timezone = "America/Los_Angeles".into();
            prefs.regional.location_mode = "custom".into();
            prefs.regional.latitude = 1.3521;
            prefs.regional.longitude = 103.8198;
            prefs.advanced.location = PermissionMode::Allow;
            let first = browser(engine, prefs, &fixture.url("/region"));
            first.control.open(fixture.url("/first"), false).unwrap();
            let data = fixture.report(&first);
            println!("{engine} custom: {data}");
            check(
                &data,
                "de-DE",
                "America/Los_Angeles",
                480,
                420,
                1.3521,
                103.8198,
            );
            assert_eq!(data["webdriver"], true);
            let mut secondprefs = Preferences::default();
            secondprefs.language = "ja-JP,ja,en".into();
            secondprefs.regional.language_mode = "ip".into();
            secondprefs.regional.timezone_mode = "ip".into();
            secondprefs.regional.location_mode = "ip".into();
            secondprefs.advanced.location = PermissionMode::Allow;
            let second = browser(engine, secondprefs, &fixture.url("/region"));
            second.control.open(fixture.url("/second"), false).unwrap();
            let data = fixture.report(&second);
            println!("{engine} IP: {data}");
            check(&data, "ja-JP", "Asia/Tokyo", -540, -540, 35.68, 139.69);
            first.control.open(fixture.url("/new-tab"), true).unwrap();
            let data = fixture.report(&first);
            println!("{engine} new tab: {data}");
            check(
                &data,
                "de-DE",
                "America/Los_Angeles",
                480,
                420,
                1.3521,
                103.8198,
            );
            assert_eq!(data["webdriver"], true);
        }
    }
    #[test]
    #[ignore = "Uses the live HTTPS region provider through a temporary Chrome profile and tests the complete profile launch/relaunch path"]
    fn live_ip_matching_uses_browser_network_path() {
        let fixture = Fixture::new();
        let root = tempfile::tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let mut preferences = Preferences::default();
        preferences.regional.language_mode = "ip".into();
        preferences.regional.timezone_mode = "ip".into();
        preferences.regional.location_mode = "ip".into();
        preferences.advanced.location = PermissionMode::Allow;
        preferences.startup_url = fixture.url("/live-ip");
        let p = profiles::create(
            &canonical,
            Draft {
                name: "Live IP verification".into(),
                browser: "chrome".into(),
                notes: String::new(),
                tags: vec![],
                proxy: ProxyConfig {
                    mode: "direct".into(),
                    ..ProxyConfig::default()
                },
                password: None,
                clear_password: false,
                preferences,
            },
            None,
        )
        .unwrap();
        let path = profiles::path(&canonical, &p).unwrap();
        let runtime = profiles::Runtime::default();
        let result = crate::profile_commands::launch(&canonical, &p.id, "startup", &runtime)
            .and_then(|_| {
                let data = fixture
                    .reports
                    .recv_timeout(Duration::from_secs(20))
                    .map_err(|_| "live browser report timeout")?;
                let p = profiles::get(&canonical, &p.id, false)?;
                let actual = p.last_region.unwrap();
                let zone = actual
                    .timezone
                    .as_ref()
                    .unwrap()
                    .parse::<chrono_tz::Tz>()
                    .unwrap();
                use chrono::{Offset, TimeZone};
                let jan = -(zone
                    .with_ymd_and_hms(2026, 1, 15, 12, 0, 0)
                    .unwrap()
                    .offset()
                    .fix()
                    .local_minus_utc() as i64)
                    / 60;
                let jul = -(zone
                    .with_ymd_and_hms(2026, 7, 15, 12, 0, 0)
                    .unwrap()
                    .offset()
                    .fix()
                    .local_minus_utc() as i64)
                    / 60;
                check(
                    &data,
                    actual.language.split(',').next().unwrap(),
                    actual.timezone.as_deref().unwrap(),
                    jan,
                    jul,
                    actual.latitude.unwrap(),
                    actual.longitude.unwrap(),
                );
                assert!(runtime.1.ready(&p.id));
                assert!(actual.ip_region.is_some());
                println!(
                    "live IP matching verified: {} / {}",
                    actual.language,
                    actual.timezone.unwrap()
                );
                Ok(())
            });
        runtime.1.clear();
        platform::close_profile(&path).unwrap();
        result.unwrap();
    }
}
