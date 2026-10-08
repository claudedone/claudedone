# NodeCloak branding

NodeCloak uses the user-supplied original ghost symbol and app icon, without changing geometry or colors. Primary on Ink; positive on Paper. Palette: Ink #11151B, Paper #F6F4EF, Phosphor #3DDC97, Deep #0B6E48. UI uses Sora and JetBrains Mono; their OFL licenses are bundled alongside the self-hosted fonts.

Windows window/taskbar and notification-area icons use the transparent ghost symbol. They read `SystemUsesLightTheme` and watch registry changes: positive (Ink) for a light taskbar, primary (Paper) for a dark taskbar. This is independent of the application's light/dark preference because Windows allows the taskbar and apps to have different themes. Both variants are embedded locally; theme changes require no network request or restart. The Windows executable ICO is also transparent; macOS retains its supplied app icon. `scripts/generate-windows-icons.mjs` regenerates the PNG, raw RGBA and multi-size ICO assets from the original VI SVGs using sharp. Explorer may cache an existing pinned shortcut's static icon until it is refreshed or pinned again.

The new bundle identifier is `com.nodecloak`. Existing `com.claudedone` and `com.claudeready.desktop` data is reused in place because repair journals contain absolute paths. The legacy proxy credential namespace is intentionally retained so upgrades can read existing credentials. Repository URLs use https://github.com/nodecloak/nodecloak and the Telegram community uses https://t.me/nodecloak_official.

Product functionality is unchanged by artwork: each browser keeps its own login and storage. Closing a window does not erase its data. Region control can expose an automation flag; no claim of untraceability is made.
