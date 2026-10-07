import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {projectRoot,releaseVersion,verifyReleaseAssets} from './release-utils.mjs';
if(!process.env.RELEASE_TAG) throw new Error('A version tag is required to publish');
const version=releaseVersion();
const directory=path.join(projectRoot,'release-assets');
const files=verifyReleaseAssets(directory,version);
const names={
  'windows-x86_64':`ClaudeDone_${version}_windows_x64_setup.exe`,
  'darwin-aarch64':`ClaudeDone_${version}_macos_arm64_update.app.tar.gz`,
  'darwin-x86_64':`ClaudeDone_${version}_macos_x64_update.app.tar.gz`,
};
const platforms={};
for(const [platform,name] of Object.entries(names)) {
  const signature=fs.readFileSync(path.join(directory,`${name}.sig`),'utf8').trim();
  const decoded=Buffer.from(signature,'base64').toString('utf8');
  if(!decoded.startsWith('untrusted comment:') || !decoded.includes('trusted comment:') || !decoded.includes(`\tversion:${version}`)) throw new Error(`Invalid or mismatched updater signature file: ${platform}`);
  platforms[platform]={url:`https://github.com/claudedone/claudedone/releases/download/v${version}/${name}`,signature};
}
const releaseNotes=['新增 Chrome、Edge、Firefox 多副本管理：独立登录、配置、修复记录和检测报告，支持复制配置、标签搜索、最近删除与恢复。','每个副本可选择直连、系统代理、HTTP / HTTPS / SOCKS5，并支持认证和代理链接识别；密码保存到系统凭据存储，自定义代理失败不回退直连。','支持并行启动、定位窗口、关闭和重启；可查看出口 IP、地区、延迟与连接结果，官网报告可按副本导入。','自动接入旧专用浏览器目录，保留登录数据。电脑级时区、字体和 Claude Code 独立管理；关闭主窗口继续后台运行，更新前关闭副本。'];
const manifest={version,notes:releaseNotes.map(note=>`- ${note}`).join('\n'),pub_date:new Date().toISOString(),platforms};
fs.writeFileSync(path.join(directory,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
files.push('latest.json');
const sums=files.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex')}  ${name}`).join('\n')+'\n';
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),sums);
fs.writeFileSync(path.join(projectRoot,'.release-notes.md'),`Claude Done ${version}。安装包由本版本标签的 GitHub Actions 自动构建。\n\n${manifest.notes}\n\n0.5.8 及更早版本需要先下载并升级一次，后续点击“立即更新”即可在应用内完成更新。\n\n| 平台 | 手动安装文件 |\n| --- | --- |\n| Windows x64 安装版 | ClaudeDone_${version}_windows_x64_setup.exe |\n| Windows x64 便携版 | ClaudeDone_${version}_windows_x64_portable.exe |\n| macOS Apple Silicon（M 系列） | ClaudeDone_${version}_macos_arm64.dmg |\n| macOS Intel | ClaudeDone_${version}_macos_x64.dmg |\n\nlatest.json、签名文件和 app.tar.gz 供应用自动更新使用。SHA256SUMS.txt 提供包校验值；THIRD_PARTY_NOTICES 归档包含三端依赖许可。\n\n自动更新签名已启用；macOS 包未做 Apple 公证，Windows 包未做 Authenticode 代码签名。\n`);
console.log(`Verified complete release ${version}; checksums and release notes written.`);
