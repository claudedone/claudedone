import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {projectRoot,releaseVersion,verifyReleaseAssets} from './release-utils.mjs';
if(!process.env.RELEASE_TAG) throw new Error('A version tag is required to publish');
const version=releaseVersion();
const directory=path.join(projectRoot,'release-assets');
const files=verifyReleaseAssets(directory,version);
const names={
  'windows-x86_64':`NodeCloak_${version}_windows_x64_setup.exe`,
  'darwin-aarch64':`NodeCloak_${version}_macos_arm64_update.app.tar.gz`,
  'darwin-x86_64':`NodeCloak_${version}_macos_x64_update.app.tar.gz`,
};
const platforms={};
for(const [platform,name] of Object.entries(names)) {
  const signature=fs.readFileSync(path.join(directory,`${name}.sig`),'utf8').trim();
  const decoded=Buffer.from(signature,'base64').toString('utf8');
  if(!decoded.startsWith('untrusted comment:') || !decoded.includes('trusted comment:') || !decoded.includes(`\tversion:${version}`)) throw new Error(`Invalid or mismatched updater signature file: ${platform}`);
  platforms[platform]={url:`https://github.com/nodecloak/nodecloak/releases/download/v${version}/${name}`,signature};
}
const releaseNotes=[
  "客户端支持简体中文与 English，默认跟随系统语言，可在偏好设置切换并保存。 / Chinese and English UI, automatic system-language selection and saved preferences.",
  "终端工作区支持 Claude Code、ChatGPT / Codex CLI、Gemini CLI 和普通终端，可检测安装状态、查看安装指南并选择工作目录。 / Terminal workspace for Claude Code, Codex CLI, Gemini CLI and a regular shell, with installation detection, setup guides and working-directory selection.",
  "专用终端只设置进程语言与时区，保留已有代理、API 密钥及认证配置。 / Dedicated terminal launchers preserve existing proxy, API key and authentication settings.",
  "改进 Claude 网络检测：识别地区不可用页面和验证挑战，分别检测 claude.ai 与 claude.com 的同域名 TCP 出口，明确 HTTP/3 路径需单独确认。 / Claude diagnostics distinguish unavailable-region pages and challenges, and report domain-specific TCP exits separately from HTTP/3 browser routes.",
  "保留多浏览器副本与独立代理、字体可见性、深浅色主题、无系统标题栏设计及透明任务栏和托盘图标。 / Includes isolated browser profiles and proxies, font visibility controls, light/dark themes, frameless windows and transparent taskbar/tray icons.",
  "修复环境概览和终端页面区块间距，统一浏览器 SVG 图标、细滚动条和边框焦点样式。 / Refined panel spacing, browser SVG icons, slim scrollbars and border-based focus styling."
];
const manifest={version,notes:releaseNotes.map(note=>`- ${note}`).join('\n'),pub_date:new Date().toISOString(),platforms};
fs.writeFileSync(path.join(directory,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
files.push('latest.json');
const sums=files.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')}  ${name}`).join('\n')+'\n';
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),sums);
fs.writeFileSync(path.join(projectRoot,'.release-notes.md'),`NodeCloak ${version}。安装包由本版本标签的 GitHub Actions 自动构建。\n\n${manifest.notes}\n\n0.5.9 及后续版本可继续使用已签名的应用内更新。品牌更新保留已有配置；macOS 的旧应用入口名称可能保留，手动安装新版 DMG 后可使用 NodeCloak 入口。\n\n| 平台 | 手动安装文件 |\n| --- | --- |\n| Windows x64 安装版 | NodeCloak_${version}_windows_x64_setup.exe |\n| Windows x64 便携版 | NodeCloak_${version}_windows_x64_portable.exe |\n| macOS Apple Silicon（M 系列） | NodeCloak_${version}_macos_arm64.dmg |\n| macOS Intel | NodeCloak_${version}_macos_x64.dmg |\n\nlatest.json、签名文件和 app.tar.gz 供应用自动更新使用。SHA256SUMS.txt 提供包校验值；THIRD_PARTY_NOTICES 归档包含三端依赖许可。\n\n自动更新签名已启用；macOS 包未做 Apple 公证，Windows 包未做 Authenticode 代码签名。\n`);
console.log(`Verified complete release ${version}; checksums and release notes written.`);
