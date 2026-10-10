use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::{error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let root = PathBuf::from(std::env::args().nth(1).ok_or("Usage: verify-updates <release-assets-directory> [windows-x86_64|darwin-aarch64|darwin-x86_64]")?);
    let config: Value = serde_json::from_slice(&fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))?)?;
    let public_key = String::from_utf8(STANDARD.decode(config["plugins"]["updater"]["pubkey"].as_str().ok_or("Missing update public key")?)?)?;
    let key = PublicKey::decode(&public_key)?;
    let manifest: Value = serde_json::from_slice(&fs::read(root.join("latest.json"))?)?;
    let version = manifest["version"].as_str().ok_or("Missing update version")?;
    let platforms = manifest["platforms"].as_object().ok_or("Missing updater platforms")?;
    let selected = std::env::args().nth(2);
    let supported = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"];
    if selected.as_deref().is_some_and(|platform| !supported.contains(&platform)) {
        return Err("Unknown verification platform".into());
    }
    for platform in supported.into_iter().filter(|platform| selected.as_deref().is_none_or(|value| value == *platform)) {
        let entry = platforms.get(platform).ok_or("Missing platform update")?;
        let url = reqwest::Url::parse(entry["url"].as_str().ok_or("Missing update URL")?)?;
        if url.scheme() != "https" || url.host_str() != Some("github.com") || !url.path().starts_with(&format!("/nodecloak/nodecloak/releases/download/v{version}/")) {
            return Err("Unexpected updater release URL".into());
        }
        let name = url.path_segments().and_then(|mut parts| parts.next_back()).ok_or("Invalid update filename")?;
        let signature = String::from_utf8(STANDARD.decode(entry["signature"].as_str().ok_or("Missing update signature")?)?)?;
        let signature = Signature::decode(&signature)?;
        let data = fs::read(root.join(name))?;
        key.verify(&data, &signature, true)?;
        if signature.trusted_comment().split('\t').find_map(|field| field.strip_prefix("version:")) != Some(version) {
            return Err("Signature version does not match update manifest".into());
        }
        let mut changed = data;
        changed[0] ^= 1;
        if key.verify(&changed, &signature, true).is_ok() {
            return Err("Tampered package unexpectedly verified".into());
        }
        println!("Verified update signature and tamper rejection: {platform}");
    }
    Ok(())
}
