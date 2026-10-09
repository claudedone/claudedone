import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = process.env.VERSION;
const expected = process.env.EXPECTED_SHA256?.toLowerCase();
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^[a-f0-9]{64}$/.test(expected || '')) {
  throw new Error('A release version and full SHA256 are required');
}
const configured = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (version !== configured) throw new Error('Version must match this checkout');
const name = `NodeCloak_${version}_windows_x64_setup.authenticode.exe`;
mkdirSync('signing-input', { recursive: true });
execFileSync('gh', ['release', 'download', `v${version}`, '--repo', 'nodecloak/nodecloak', '--pattern', name, '--dir', 'signing-input'], { stdio: 'inherit' });
const file = `signing-input/${name}`;
if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected) {
  throw new Error('Staged installer checksum mismatch');
}
renameSync(file, 'signing-input/setup.exe');
console.log('Verified installer checksum; ready for app update signing');
