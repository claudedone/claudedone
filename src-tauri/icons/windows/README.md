# Windows shell icons

Original VI symbols from `public/brand/symbol-positive.svg` and
`symbol-primary.svg`, rasterized without adding a background.

- `on-light`: Ink foreground for a light Windows taskbar.
- `on-dark`: Paper foreground for a dark Windows taskbar.
- PNGs are reviewable assets; `.rgba` files are tightly packed RGBA8 bytes,
  embedded by the Rust backend (32px tray, 128px window/taskbar).
- ICOs contain 16, 24, 32, 48, 64, 128 and 256px transparent frames.
  The default executable `../icon.ico` uses the on-dark variant; the running
  window and tray select a variant from the Windows taskbar theme.

Regenerate with `node scripts/generate-windows-icons.mjs` and sharp available
to Node. For a bundled sharp installation set `NODECLOAK_SHARP_PATH` to its
absolute package path. Checked-in assets make sharp unnecessary for normal
builds.
