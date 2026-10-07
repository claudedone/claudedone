import fs from 'node:fs';
import path from 'node:path';
import {projectRoot,releaseVersion,packageNames} from './release-utils.mjs';
const version=releaseVersion();
const platform=process.argv[2];
const native={'windows-x64':['win32','x64'],'macos-arm64':['darwin','arm64'],'macos-x64':['darwin','x64']}[platform];
if(!native || native[0]!==process.platform || native[1]!==process.arch) throw new Error(`Runner does not match release platform: ${platform}`);
const release=path.join(projectRoot,'src-tauri/target/release');
const names=packageNames(version);
const files=platform==='windows-x64'
  ? [[`bundle/nsis/Claude Done_${version}_x64-setup.exe`,names[0]],['claude-done.exe',names[1]]]
  : [[`bundle/dmg/Claude Done_${version}_${platform==='macos-arm64'?'aarch64':'x64'}.dmg`,names[platform==='macos-arm64'?2:3]]];
const output=path.join(projectRoot,'release-assets');
fs.mkdirSync(output,{recursive:true});
for(const [relative,name] of files) {
  const source=path.join(release,relative);
  if(!fs.statSync(source).isFile() || fs.statSync(source).size===0) throw new Error(`Missing build package: ${source}`);
  fs.copyFileSync(source,path.join(output,name));
  console.log(`Collected ${name}`);
}
