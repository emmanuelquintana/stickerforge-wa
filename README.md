# StickerForge Desktop

[Español](README.es.md)

StickerForge is a local media editor for Windows x64. Sticker Studio exports 512 × 512 WebP stickers and optional separate Opus tracks. Audio Studio trims and processes audio, with Ogg/Opus and MP3 export. An optional private WhatsApp bot handles the retained chat commands using the same media engine.

## Install

Run the Windows EXE or MSI. For the portable edition, extract the complete ZIP and run `stickerforge.exe` next to the `engine` directory. Use **Set up engine** on the welcome screen to download FFmpeg and FFprobe and verify the archive against its pinned SHA-256. After setup, local conversions run offline and work without a WhatsApp account.

Settings also accepts a pinned FFmpeg ZIP and verifies the same checksum before installing. Windows artifacts are unsigned. The MSI requires administrator privileges. [FFmpeg 9.1 ZIP](https://github.com/GyanD/codexffmpeg/releases/download/9.1/ffmpeg-9.1-essentials_build.zip)

The app can pair with WhatsApp using a QR code. Configure allowed numbers and start the bot in the WhatsApp section. Baileys is an unofficial integration and WhatsApp may suspend accounts that use it. Use a secondary account. Experimental sound-sticker playback depends on the receiving WhatsApp client.

The downloader accepts direct public HTTPS video links. Social-platform extraction requires additional network isolation. StickerForge collections use `.sfpack` and include WebP assets for sharing between installations.

## Build and verify

Use Node.js 24, Rust stable for MSVC, Microsoft C++ Build Tools and WebView2. With FFmpeg and FFprobe on PATH:

```powershell
npm ci
npm run build
npm test
pwsh -File scripts/stage-windows.ps1
npm run desktop -- build --ci
pwsh -File scripts/collect-windows.ps1
```

See [architecture](ARCHITECTURE.md), [bot commands](COMMANDS.md), [security](SECURITY.md), [benchmarks](BENCHMARKS.md), [verification and remaining work](VALIDATION.md), [design and screenshots](DESIGN.md) and [v0.3.0 terminal documentation](docs/legacy-v0.3.0.md). The source is MIT and [NOTICE.md](NOTICE.md) records upstream attribution.
