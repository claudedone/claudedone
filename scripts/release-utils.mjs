import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=path.resolve(fileURLToPath(new URL('../',import.meta.url)));

export function releaseVersion(root=projectRoot,tag=process.env.RELEASE_TAG || '') {
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be a stable x.y.z version');
  const tauri=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/tauri.conf.json'),'utf8'));
  const cargo=fs.readFileSync(path.join(root,'src-tauri/Cargo.toml'),'utf8').split('[package]')[1]?.split(/\r?\n\[/)[0];
  const cargoVersion=/^version\s*=\s*"([^"]+)"/m.exec(cargo || '')?.[1];
  if(tauri.version!==version || cargoVersion!==version) throw new Error('package.json, Cargo.toml and Tauri versions must match');
  if(tag && tag!==`v${version}`) throw new Error(`Tag ${tag} does not match v${version}`);
  return version;
}

export function packageNames(version) {
  return [
    `NodeCloak_${version}_windows_x64_setup.exe`,
    `NodeCloak_${version}_windows_x64_portable.exe`,
    `NodeCloak_${version}_macos_arm64.dmg`,
    `NodeCloak_${version}_macos_x64.dmg`,
  ];
}

export function updaterAssets(version) {
  return [
    `${packageNames(version)[0]}.sig`,
    `NodeCloak_${version}_macos_arm64_update.app.tar.gz`,
    `NodeCloak_${version}_macos_arm64_update.app.tar.gz.sig`,
    `NodeCloak_${version}_macos_x64_update.app.tar.gz`,
    `NodeCloak_${version}_macos_x64_update.app.tar.gz.sig`,
  ];
}

export function verifyReleaseAssets(directory,version) {
  const expected=[...packageNames(version),...updaterAssets(version),`NodeCloak_${version}_THIRD_PARTY_NOTICES.tar.gz`].sort();
  const files=fs.readdirSync(directory).filter(name=>!['SHA256SUMS.txt','latest.json'].includes(name)).sort();
  if(JSON.stringify(files)!==JSON.stringify(expected)) throw new Error('Release must contain all four platform packages, signed updater bundles and the notice archive, with no unexpected assets');
  for(const name of files) {
    const info=fs.lstatSync(path.join(directory,name));
    if(!info.isFile() || info.size===0) throw new Error(`Invalid or empty release asset: ${name}`);
  }
  return files;
}
