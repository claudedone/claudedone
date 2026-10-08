use crate::{engine, platform};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Claude,
    Codex,
    Gemini,
    Shell,
}

impl Tool {
    pub fn command(self) -> Option<&'static str> {
        match self {
            Self::Claude => Some("claude"),
            Self::Codex => Some("codex"),
            Self::Gemini => Some("gemini"),
            Self::Shell => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex CLI",
            Self::Gemini => "Gemini CLI",
            Self::Shell => "终端",
        }
    }
    fn slug(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Shell => "shell",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: Tool,
    pub installed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub tools: Vec<ToolStatus>,
    pub home_directory: String,
}

fn search_roots() -> Vec<PathBuf> {
    let home = platform::home_dir();
    let mut roots: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    roots.extend([
        home.join(".local/bin"),
        home.join(".npm-global/bin"),
        home.join(".bun/bin"),
    ]);
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            roots.push(PathBuf::from(appdata).join("npm"));
        }
    } else {
        roots.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
    }
    roots
}

fn find_in(tool: Tool, roots: &[PathBuf], windows: bool) -> Option<PathBuf> {
    let command = tool.command()?;
    let names = if windows {
        vec![format!("{command}.exe"), format!("{command}.cmd")]
    } else {
        vec![command.to_owned()]
    };
    roots.iter().find_map(|root| {
        names
            .iter()
            .map(|name| root.join(name))
            .find(|file| file.is_file())
    })
}

pub fn catalog() -> Catalog {
    let roots = search_roots();
    Catalog {
        home_directory: platform::home_dir().display().to_string(),
        tools: [Tool::Claude, Tool::Codex, Tool::Gemini, Tool::Shell]
            .into_iter()
            .map(|id| ToolStatus {
                id,
                installed: id == Tool::Shell || find_in(id, &roots, cfg!(windows)).is_some(),
            })
            .collect(),
    }
}

pub fn open_guide(tool: Tool) -> Result<(), String> {
    let url = match tool {
        Tool::Claude => "https://code.claude.com/docs/en/setup",
        Tool::Codex => "https://learn.chatgpt.com/docs/codex/cli",
        Tool::Gemini => "https://geminicli.com/docs/get-started/installation/",
        Tool::Shell => return Err("普通终端无需安装 CLI。".into()),
    };
    platform::open_external(url)
}

fn launcher_contents(tool: Tool, windows: bool) -> String {
    if windows {
        let start = if let Some(command) = tool.command() {
            format!("$cli = Get-Command {command} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1\r\nif (-not $cli) {{ throw '{} is not installed or not on PATH.' }}\r\n& $cli.Source\r\n", tool.name())
        } else {
            "Write-Host 'NodeCloak terminal ready. Run claude, codex, gemini, or your preferred CLI.'\r\n".into()
        };
        format!("# NodeCloak managed terminal launcher\r\nparam([string]$WorkingDirectory = $env:USERPROFILE)\r\n$ErrorActionPreference = 'Stop'\r\n$env:TZ = 'Asia/Singapore'\r\n$env:LANG = 'en_US.UTF-8'\r\n$env:LC_ALL = 'en_US.UTF-8'\r\n$env:PATH = (Join-Path $env:USERPROFILE '.local/bin') + ';' + (Join-Path $env:USERPROFILE '.npm-global/bin') + ';' + (Join-Path $env:USERPROFILE '.bun/bin') + ';' + (Join-Path $env:APPDATA 'npm') + ';' + $env:PATH\r\nSet-Location -LiteralPath $WorkingDirectory\r\n{start}")
    } else {
        let start = if let Some(command) = tool.command() {
            format!("if ! command -v {command} >/dev/null 2>&1; then echo '{} is not installed or not on PATH.'; exit 1; fi\nexec {command}\n", tool.name())
        } else {
            "exec /bin/zsh -i\n".into()
        };
        format!("#!/bin/zsh\n# NodeCloak managed terminal launcher\nexport PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"\nexport TZ=Asia/Singapore\nexport LANG=en_US.UTF-8\nexport LC_ALL=en_US.UTF-8\ncd -- \"${{1:-$HOME}}\" || exit 1\n{start}")
    }
}

fn working_directory(input: &str) -> Result<PathBuf, String> {
    let path = if input.trim().is_empty() {
        platform::home_dir()
    } else {
        PathBuf::from(input.trim())
    };
    if !path.is_absolute() || !path.is_dir() {
        return Err(
            "请选择已存在的绝对工作目录，例如 D:\\Projects 或 /Users/name/Projects。".into(),
        );
    }
    Ok(path)
}

#[cfg(windows)]
fn windows_command(contents: &str) -> String {
    // Run our fixed commands inline: local .ps1 files may be blocked by the default policy.
    // The directory is passed as a child-process environment value, never interpolated as code.
    format!("& {{\r\n{contents}\r\n}} -WorkingDirectory $env:NODECLOAK_TERMINAL_DIRECTORY")
}

#[cfg(any(target_os = "macos", test))]
fn mac_command(path: &Path, directory: &Path) -> String {
    let quote = |value: &Path| format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"));
    let shell = format!("{} {}", quote(path), quote(directory));
    format!(
        "tell application \"Terminal\" to do script \"{}\"",
        shell.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

pub fn launch(root: &Path, tool: Tool, directory: &str) -> Result<(), String> {
    let directory = working_directory(directory)?;
    if tool != Tool::Shell && find_in(tool, &search_roots(), cfg!(windows)).is_none() {
        return Err(format!("未找到 {}，请先安装后点击重新检测。", tool.name()));
    }
    let folder = root.join("terminal-launchers");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!(
        "{}.{}",
        tool.slug(),
        if cfg!(windows) { "ps1" } else { "command" }
    ));
    let contents = launcher_contents(tool, cfg!(windows));
    if path.exists() && fs::read_to_string(&path).map_err(|e| e.to_string())? != contents {
        return Err("这个终端启动器已被修改，未覆盖它。请移走自定义文件后重试。".into());
    }
    if !path.exists() {
        engine::atomic_write(&path, contents.as_bytes())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // The user explicitly opens an interactive terminal from the terminal workspace.
        Command::new("powershell.exe")
            .args(["-NoExit", "-NoProfile", "-Command"])
            .arg(windows_command(&contents))
            .env("NODECLOAK_TERMINAL_DIRECTORY", &directory)
            .current_dir(&directory)
            .creation_flags(0x00000010)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("/usr/bin/osascript")
            .args([
                "-e",
                &mac_command(&path, &directory),
                "-e",
                "tell application \"Terminal\" to activate",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err("无法打开 Terminal，请检查 macOS 自动化权限。".into());
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        return Err("目前终端启动支持 Windows 和 macOS。".into());
    }
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn powershell_launcher_runs_npm_cli_in_literal_project_directory() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        let project = root.path().join("Project's $(Write-Error injected)");
        fs::create_dir(&project).unwrap();
        let fixture="@echo off\r\necho TZ=%TZ%\r\necho LANG=%LANG%\r\necho LC_ALL=%LC_ALL%\r\necho PROXY=%HTTPS_PROXY%\r\necho KEY=%OPENAI_API_KEY%\r\necho DIR=\"%CD%\"\r\n";
        fs::write(bin.join("codex.cmd"), fixture).unwrap();
        let result = platform::command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command"])
            .arg(windows_command(&launcher_contents(Tool::Codex, true)))
            .env("NODECLOAK_TERMINAL_DIRECTORY", &project)
            .env("USERPROFILE", root.path())
            .env("APPDATA", root.path())
            .env("HTTPS_PROXY", "http://fixture.invalid:8080")
            .env("OPENAI_API_KEY", "fixture-value")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let text = String::from_utf8_lossy(&result.stdout);
        for expected in [
            "TZ=Asia/Singapore",
            "LANG=en_US.UTF-8",
            "LC_ALL=en_US.UTF-8",
            "PROXY=http://fixture.invalid:8080",
            "KEY=fixture-value",
        ] {
            assert!(
                text.contains(expected),
                "Missing {expected} in fixture output"
            );
        }
        let actual_directory = text
            .lines()
            .find_map(|line| line.strip_prefix("DIR=\"").and_then(|value| value.strip_suffix('"')))
            .expect("The CLI fixture must report its working directory");
        // cmd.exe may expand an 8.3 temporary root (RUNNER~1) to its long spelling.
        assert_eq!(
            fs::canonicalize(actual_directory).unwrap(),
            fs::canonicalize(&project).unwrap()
        );
        assert!(!text.contains("Write-Error :"));
    }
    #[test]
    fn only_known_tools_are_accepted_and_npm_shims_are_found() {
        assert!(serde_json::from_str::<Tool>("\"codex; touch injected\"").is_err());
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("codex.cmd"), "fixture").unwrap();
        fs::write(dir.path().join("gemini.ps1"), "fixture").unwrap();
        assert!(find_in(Tool::Codex, &[dir.path().to_owned()], true).is_some());
        assert!(find_in(Tool::Claude, &[dir.path().to_owned()], true).is_none());
        // Do not declare a policy-restricted .ps1-only installation launchable.
        assert!(find_in(Tool::Gemini, &[dir.path().to_owned()], true).is_none());
    }
    #[test]
    fn launchers_preserve_credentials_and_literal_working_directories() {
        for tool in [Tool::Claude, Tool::Codex, Tool::Gemini, Tool::Shell] {
            for windows in [true, false] {
                let script = launcher_contents(tool, windows);
                assert!(script.contains("Asia/Singapore") && script.contains("en_US.UTF-8"));
                assert!(
                    !script.contains("API_KEY")
                        && !script.contains("PROXY")
                        && !script.contains("ExecutionPolicy")
                );
                if let Some(command) = tool.command() {
                    assert!(script.contains(command));
                }
                assert!(script.contains(if windows {
                    "-LiteralPath $WorkingDirectory"
                } else {
                    "cd -- \"${1:-$HOME}\""
                }));
            }
        }
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            working_directory(dir.path().to_str().unwrap()).unwrap(),
            dir.path()
        );
        assert!(working_directory("relative/project").is_err());
        assert!(working_directory(dir.path().join("missing").to_str().unwrap()).is_err());
    }
    #[test]
    fn mac_terminal_quotes_paths_for_both_shell_and_applescript() {
        let line = mac_command(
            Path::new("/Users/a'b/launcher.command"),
            Path::new("/Users/a/Project \"$()\""),
        );
        assert!(line.contains("a'\\\\''b"));
        assert!(line.contains("\\\"$()\\\""));
        assert!(line.starts_with("tell application \"Terminal\" to do script \"'"));
    }
}
