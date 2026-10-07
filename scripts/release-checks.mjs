import test from 'node:test';
// Run with node --test; keep separate from the frontend Vitest suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {releaseVersion,packageNames,updaterAssets,verifyReleaseAssets} from './release-utils.mjs';

test('a mismatched tag or native version blocks publication',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'claudedone-version-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'src-tauri'));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.5.8'}));
  fs.writeFileSync(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({version:'0.5.8'}));
  fs.writeFileSync(path.join(root,'src-tauri/Cargo.toml'),'[package]\nversion = "0.5.8"\n[dependencies]\n');
  assert.equal(releaseVersion(root,'v0.5.8'),'0.5.8');
  assert.throws(()=>releaseVersion(root,'v0.5.9'),/does not match/);
  fs.writeFileSync(path.join(root,'src-tauri/Cargo.toml'),'[package]\nversion = "0.5.7"\n');
  assert.throws(()=>releaseVersion(root,'v0.5.8'),/versions must match/);
});

test('incomplete, stale or empty asset sets cannot be released',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'claudedone-assets-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const names=[...packageNames('0.5.8'),...updaterAssets('0.5.8'),'NodeCloak_0.5.8_THIRD_PARTY_NOTICES.tar.gz'];
  for(const name of names.slice(1)) fs.writeFileSync(path.join(root,name),'package');
  assert.throws(()=>verifyReleaseAssets(root,'0.5.8'),/all four/);
  fs.writeFileSync(path.join(root,names[0]),'package');
  assert.equal(verifyReleaseAssets(root,'0.5.8').length,10);
  fs.writeFileSync(path.join(root,'stale.exe'),'package');
  assert.throws(()=>verifyReleaseAssets(root,'0.5.8'),/unexpected/);
  fs.unlinkSync(path.join(root,'stale.exe'));
  fs.writeFileSync(path.join(root,names[0]),'');
  assert.throws(()=>verifyReleaseAssets(root,'0.5.8'),/empty/);
});
