# NodeCloak

Windows 与 macOS 的 Claude 环境诊断和可撤销配置工具。基于 Tauri 2、React、TypeScript 和 Rust。

[GitHub 下载](https://github.com/claudedone/claudedone/releases/latest) · [官网](https://claudedone.com) · [Telegram](https://t.me/claudedone) · [MIT License](LICENSE)

## 功能

- 多副本管理：Chrome / Edge / Firefox 可创建多个独立目录，登录、配置、修复记录与报告按副本隔离。
- 每个副本独立选择直连、系统代理、HTTP / HTTPS / SOCKS5；支持认证、代理链接识别、出口 IP / 地区 / 延迟测试。
- 并行启动、定位窗口、关闭与重启；支持名称、标签、备注、搜索、复制配置、最近删除、恢复与彻底删除。
- 独立 Firefox 字体可见性设置，保留电脑原有字体；未安装时提供官方下载和重新检测。
- 分别检查系统时区名称和实际 UTC 偏移，支持系统认可的自定义时区。
- Claude Code 检查与专用启动器。
- 可选用户字体处理、修改前备份、处理后核验及按项恢复。
- 本地浏览器报告导入，以及应用内签名自动更新。

系统时区和字体处理由用户选择并确认影响。配置写入成功不等于浏览器实际值已改变，应关闭旧专用窗口再复检。环境检测不是 Anthropic 官方账户风险结论，工具不保证账户结果。项目与 Anthropic 无隶属关系。

## 开发

需要 Node.js 24、Rust stable；Windows 需要 Visual Studio C++ Build Tools 和 WebView2，macOS 需要 Xcode Command Line Tools。

```sh
npm ci
npm run tauri dev
```

只预览前端：`npm run dev`，访问 `http://127.0.0.1:1420`。该模式使用演示数据，不更改电脑配置。

## 测试与构建

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

本机打包：`node scripts/build-desktop.mjs`。Windows 生成 NSIS 安装包，Mac 生成应用与 DMG；普通本地构建关闭更新包签名，不需要维护者私钥。

CI 分别使用 Windows、Apple Silicon Mac 和 Intel Mac 构建。产物保存在 `src-tauri/target/release/bundle/`；推送版本标签时生成签名更新包并发布 GitHub Release，不自动部署官网。Windows 代码签名与 Apple 公证需要维护者单独配置，密钥不能提交到源码。

## 自动发布

更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中的版本，提交后创建并推送 `v版本号` 标签，例如 `git tag v0.6.0`、`git push origin v0.6.0`。标签必须与三处主版本设置一致。

GitHub Actions 会测试和构建 Windows x64、Mac Apple Silicon 和 Intel；所有平台通过后自动发布 GitHub Release，包括 Windows 安装版、便携版、两种 DMG、三端第三方许可归档和 `SHA256SUMS.txt`。主分支、PR 和手动运行只生成构建产物，推送版本标签才发布。已经公开的 Release 不会被工作流覆盖；失败任务可通过 Actions 重新运行。

从 0.5.9 开始，启动时和每 6 小时通过 GitHub Release 的 `latest.json` 检查新版本；点击“立即更新”后应用下载更新包，签名校验通过才安装并重启。失败时可重试，用户配置与修复记录保留。0.5.8 及更早版本需手动升级一次。Windows 便携版更新也使用 NSIS 安装器，会安装并启动安装版，原便携文件不会自行更换；持续自动更新建议使用安装版。

维护者需要在仓库 Actions Secrets 配置 `TAURI_SIGNING_PRIVATE_KEY`。公钥在 `src-tauri/tauri.conf.json`；私钥不能进入仓库，需单独备份。PR 和普通分支构建不读取签名私钥。发布还包含三端 `.sig`、Mac `app.tar.gz` 更新包和更新清单。Tauri 更新签名不等于 Windows Authenticode 签名或 Apple 公证。

下载 Release 所有附件到一个目录后，可用 `cargo run --manifest-path src-tauri/Cargo.toml --example verify-updates -- <目录>` 核验三端更新签名及篡改拒绝。

首次提交从 0.5.8 桌面源码快照导出，不包含旧 Git 历史、官网源码、运维记录、历史安装包或本机工具链缓存。开源版本使用独立绿色图标，见 [图标说明](docs/branding.md)。官网和已发布的 0.5.8 安装包是独立发布，不由此次源码拆分重新打包。

0.6.0 多副本操作、代理行为、迁移与维护说明见 [浏览器副本指南](docs/browser-profiles.md)。

## 配置与隐私

新安装的数据位于 `%APPDATA%/com.nodecloak`（Windows）或 `~/Library/Application Support/com.nodecloak`（macOS）。升级优先复用已有 `com.claudedone`，再兼容 `com.claudeready.desktop`；原路径保持不变以保护含绝对路径的修复记录。旧代理凭据命名空间继续保留。

工具不读取 Claude 密钥、浏览器 cookies 或登录凭据，不上传修复备份。连接检查访问 Claude 和 Cloudflare，更新检查和下载访问 GitHub Releases；这些服务会看到普通网络请求和客户端 IP。专用浏览器需要用户自行登录。代理密码保存于 Windows 凭据管理器或 macOS 钥匙串，不写入副本 JSON、命令行或修复记录。关闭主窗口会隐藏到托盘并保持代理运行；退出应用、安装更新前先关闭专用副本。

分支版本默认沿用官方更新频道；自行发行前应更改 `src-tauri/tauri.conf.json` 的更新端点、公钥及相关官网下载入口，并在独立仓库配置自己的签名私钥。

## 贡献与许可

见 [贡献指南](CONTRIBUTING.md)、[安全反馈](SECURITY.md) 和 [第三方许可说明](THIRD_PARTY_NOTICES.md)。项目原创源码与本仓库图标使用 MIT；依赖保留各自许可。
