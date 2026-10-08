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
  '去掉系统标题栏，窗口拖动、双击最大化及最小化、还原、关闭操作整合到应用顶部；关闭后仍收起到托盘。',
  '桌面控件按 NodeCloak VI 统一设计：按钮、输入框、开关、复选框、分段选择器、状态标签和弹窗支持深浅色主题。',
  'Chrome、Edge 和 Firefox 使用各自的 SVG 图标；滚动条缩小为 4px，仅在区域激活时显示，控件焦点通过边框变色提示。',
  'Windows 任务栏和系统托盘采用透明幽灵图标，跟随 Windows 任务栏主题自动切换深浅配色。',
  '修复电脑环境、环境概览及 Claude Code 页面区块间距、字体操作按钮间隔及较窄窗口的控件布局。',
  '交流群统一为 https://t.me/nodecloak_official；源码、下载和签名自动更新统一使用 https://github.com/nodecloak/nodecloak。',
];
const manifest={version,notes:releaseNotes.map(note=>`- ${note}`).join('\n'),pub_date:new Date().toISOString(),platforms};
fs.writeFileSync(path.join(directory,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
files.push('latest.json');
const sums=files.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')}  ${name}`).join('\n')+'\n';
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),sums);
fs.writeFileSync(path.join(projectRoot,'.release-notes.md'),`NodeCloak ${version}。安装包由本版本标签的 GitHub Actions 自动构建。\n\n${manifest.notes}\n\n0.5.9 及后续版本可继续使用已签名的应用内更新。品牌更新保留已有配置；macOS 的旧应用入口名称可能保留，手动安装新版 DMG 后可使用 NodeCloak 入口。\n\n| 平台 | 手动安装文件 |\n| --- | --- |\n| Windows x64 安装版 | NodeCloak_${version}_windows_x64_setup.exe |\n| Windows x64 便携版 | NodeCloak_${version}_windows_x64_portable.exe |\n| macOS Apple Silicon（M 系列） | NodeCloak_${version}_macos_arm64.dmg |\n| macOS Intel | NodeCloak_${version}_macos_x64.dmg |\n\nlatest.json、签名文件和 app.tar.gz 供应用自动更新使用。SHA256SUMS.txt 提供包校验值；THIRD_PARTY_NOTICES 归档包含三端依赖许可。\n\n自动更新签名已启用；macOS 包未做 Apple 公证，Windows 包未做 Authenticode 代码签名。\n`);
console.log(`Verified complete release ${version}; checksums and release notes written.`);
