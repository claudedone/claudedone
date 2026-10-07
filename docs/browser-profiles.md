# 浏览器副本（0.6.0）

在“浏览器副本”中新建 Chrome、Edge 或 Firefox 环境。浏览器需要事先安装；Firefox 提供全球版官方下载入口。每个副本有独立目录，不复制日常浏览器或其他副本的 Cookie、缓存或登录信息。复制配置只复制设置和代理，认证凭据另存为新条目。

名称、标签、备注用于区分用途。列表可搜索和按标签筛选。“启动”打开启动页；运行中点击“打开窗口”定位原窗口。更多操作中可检测环境、编辑设置、测试代理、查看修复记录、关闭、重启和移至最近删除。

## 代理

- 系统代理：浏览器使用自身支持的系统配置。应用进程测试会读取系统/环境代理，但 PAC、浏览器策略和分流可能不同，请在实际副本内复检。
- 直连：明确关闭浏览器代理。系统 VPN、TUN 和网络路由仍可能改变出口。
- HTTP、HTTPS、SOCKS5：按副本使用本地转发端口连接指定上游；HTTPS 指的是连接代理服务器使用 TLS，证书正常校验。目标 HTTPS 始终端到端传输，不安装拦截证书。
- 认证密码使用 Windows 凭据管理器或 macOS 钥匙串保存。SOCKS5 目标域名交给上游解析；本地仍需解析代理服务器本身的域名。

可粘贴 `socks5://user:password@host:1080` 等链接自动填写；特殊字符按 URI 规则编码。编辑时密码留空保留原值，选中“清除已保存的密码”可清除。地址、用户名和密码不会显示在命令行参数中；副本清单保留代理地址、用户名及随机凭据引用，不保存密码。

自定义代理配置的网页请求失败时不切换为直连。Chrome / Edge 禁用 QUIC 并设置非代理 UDP 隐私策略；Firefox 自定义代理关闭 WebRTC 并禁止代理失败后直连。它们不接管浏览器之外的系统流量，也不修改硬件指纹。系统代理/PAC 本身可能包含直连规则。

代理测试显示 Cloudflare 出口 IP、国家、请求耗时和 Claude HTTP 状态。403、429 等状态不能简单视为代理无效。系统分流可能让不同目的地址使用不同出口；官网检测页的出口是在当前浏览器访问本站时测得。代理提供者和检测服务会看到普通网络请求。

## 设置、检测和修复

副本编辑分为基础、代理、高级三个页签，右侧实时显示计划配置。预览不代表网站已经检测通过；启动后使用环境复检检查实际结果。运行中修改设置会标记“待重启”，保持当前连接，重启后应用最新配置。只改变名称、标签或备注无需重启。

高级设置面向个人使用，不含团队、成员权限、云同步或账号共享：

- 副本区域：语言支持跟随 IP 或自定义；时区支持跟随 IP、自定义 IANA 时区或跟随电脑；定位支持询问、允许、禁用，位置支持 IP 大致位置、自定义经纬度与精度、浏览器默认。允许定位必须选择独立位置来源。
- 启动页面：支持 HTTP、HTTPS 与空白页；区域设置准备完成后再打开目标页面。
- 隐私与指纹：WebRTC 保护与隐私偏好；Firefox 另提供字体可见性限制、可选严格指纹保护、WebGL 禁用。
- 网站权限与内容：通知、摄像头、麦克风的默认询问或禁止，以及默认不加载图片。已有网站例外不会被清除，允许过的网站仍可采用自己的设置。

Firefox 严格指纹保护使用原生 `privacy.resistFingerprinting`，默认关闭。[Mozilla 说明](https://support.mozilla.org/en-US/kb/resist-fingerprinting)描述了它对时区（UTC / Icelandic）、Canvas、语言、屏幕、硬件和媒体信息的统一处理。它并不按代理 IP 自动匹配时区，也不支持单独指定这些信号；部分网页、图片读取、视频会议或显示设置可能受影响。关闭后重启副本可恢复标准行为。该选项仅改变此 Firefox 副本，不改变系统时区或 Claude Code。

Chrome / Edge 使用真实硬件与浏览器指纹；没有提供 Canvas、Audio、WebGPU 噪音、虚拟内存/核心数或任意 UA。这些自定义信号需要另外评估定制浏览器内核。Firefox 字体白名单和严格保护也不会删除电脑字体。

独立区域设置使用 [Chrome / Edge CDP 原生接口](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)及新版 [Firefox WebDriver BiDi 原生接口](https://www.w3.org/TR/webdriver-bidi/)，不注入 Date / Intl 替换脚本。时区覆盖包含 UTC 偏移和夏令时，适用于新标签页、iframe 与 Worker。Firefox 严格指纹保护会统一时区，与独立区域设置互斥，选择独立区域会关闭严格保护。语言优先级同时写入浏览器配置；Firefox 原生区域模式将网页语言和请求语言收敛到首选语言。

“匹配当前 IP”通过副本的代理路径预览；实际启动从空白页通过浏览器自己的网络路径查询 [IPWhois HTTPS 服务](https://ipwhois.io/documentation)，按实际出口重新匹配，以兼容 PAC、TUN 与浏览器分流。若浏览器出口与预览不同，以实际浏览器结果为准；语言需要变更时在打开目标页面前重启一次。国家语言采用常用模板，不代表个人语言，多语言地区可使用自定义；IP 经纬度为大致位置，定位精度按约 20 km 返回。当前服务有配额与可用性限制，查询失败不会用真实系统区域冒充匹配成功；未打开目标页面的副本会关闭，提示重试或使用自定义设置。启动后区域保持固定，修改代理或出口后应重启重新匹配。

启用独立区域接口时，浏览器会进入可被网站读取的自动化模式（实测 `navigator.webdriver=true`）。界面提供明确提示。控制端口只监听本机回环地址，仅连接该副本目录记录的端口；请保持 NodeCloak 后台运行。本地连接中断时应用关闭此副本并记录错误；如果应用本身异常退出，需关闭并重启副本，避免继续使用已经失去覆盖的窗口。该模式不会改变电脑时区或 Claude Code 的运行环境。

禁用定位时，Firefox 关闭此副本的定位接口；Chrome / Edge 清除该副本已保存的定位授权，并禁止定位，其他权限与 Cookie 保留。改回询问后 Chrome / Edge 已清除的网站需重新授权。通知、摄像头、麦克风与图片仍采用默认权限，保留已有网站例外。

默认网站权限采用浏览器原生配置：[Firefox 权限参考](https://firefox-admin-docs.mozilla.org/reference/policies/permissions/)、[Chromium 内容设置定义](https://chromium.googlesource.com/chromium/src/+/master/chrome/common/extensions/api/content_settings.json)。新字段兼容旧版副本清单，复制配置保留高级设置而不复制 Cookie；修改和还原仅写受控字段，保留其他设置与登录数据。

副本环境检测与修复记录按 ID 隔离。从工具打开本地复检页或官网检测页后，报告带副本标记；新副本只接受同一 ID 的报告，防止同类浏览器之间混用结果。报告标记不构成身份验证，不读取账号或 Cookie。

“电脑环境”里的系统时区、UTC 偏移、用户字体卸载和 Claude Code 启动器是电脑级设置；时区或字体修改前需关闭全部专用副本。Firefox 字体可见性只针对该副本，电脑字体保留。修复或撤销后的实际值不会在下次启动时被旧默认值覆盖。

## 迁移、后台运行和删除

首次启动自动登记原来的三个默认专用浏览器。原目录保留，不移动已有登录数据。新副本位于应用数据目录的 `profiles/<随机 ID>/browser-<类型>`，记录位于同一 ID 的目录中。

关闭主窗口只隐藏到托盘，保持浏览器和代理运行。点击托盘“打开 NodeCloak”或再次启动应用可恢复窗口。真正退出使用“偏好设置 → 退出应用”或托盘“退出”，先保存输入，再关闭专用副本。应用内更新也会在检测到运行中的副本时提示关闭。

移至最近删除保留配置和数据，支持恢复。彻底删除清理该副本目录、修复记录和已保存的代理凭据，无法恢复；删除原默认副本时保留电脑级记录和其他副本数据。浏览器正在运行时不能删除。

## 验证

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

以下测试使用真实本机资源，默认不在 CI 中启动窗口：

```sh
cargo test --manifest-path src-tauri/Cargo.toml native_password_lifecycle -- --ignored
cargo test --manifest-path src-tauri/Cargo.toml real_browser_profiles -- --ignored
cargo test --manifest-path src-tauri/Cargo.toml advanced_browser_preferences -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml native_regions_are_observed -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml live_ip_matching -- --ignored --nocapture
```

第二项需要 Chrome，创建两个临时窗口和测试代理，验证 Cookie、代理及关闭动作隔离，完成后清理临时副本。不要同时重复运行同一个测试。

第三项需要 Chrome 与 Firefox，使用临时副本和本机测试页，验证浏览器实际读到的通知/定位权限、图片加载，以及 Firefox 的 UTC 偏移和 WebGL 禁用；完成后关闭并清理测试副本，不改日常浏览器。

区域测试需要 Chrome、Edge、Firefox，验证两个副本同时运行时的独立语言、请求语言、时区、冬夏 UTC 偏移和坐标，以及新标签页、Worker、跨站 iframe。最后一项通过真实 HTTPS 服务验证完整启动流程，包括语言变化时的重新启动；需联网。测试均使用临时配置并在结束后清理。
