# Verification

## Executed

- TypeScript strict build, Rust formatting and Clippy with warnings treated as errors.
- Windows Node suite with 10 passing tests. The legacy shell-based downloader mock is skipped on Windows. The Linux Media tests workflow passed.
- Native DPAPI round-trip. The Node suite verifies encrypted session persistence and rejection of a wrong key.
- Windows Tauri application started from the portable ZIP. Its verified setup installed FFmpeg and FFprobe. The native engine produced a square WebP and separate Opus track from a test clip, restored that export through SQLite history, and exported and reimported a StickerForge collection.
- A public direct HTTPS video passed through the downloader into Sticker Studio and rendered a 512 × 512 preview. Tests reject direct IP URLs and desktop platform extraction. The media test suite also verifies vertical and horizontal crops, alpha, adaptive WebP size, synchronized Opus, waveform and cancellation.
- Baileys generated a real WhatsApp linking QR in the running desktop app. The test stopped the bot without pairing an account.
- The NSIS setup installed and its uninstaller removed the executable in a clean test location. The MSI administrative layout extracted the application and Node runtime. The local silent MSI install failed with Windows Installer error 1925 under a standard user. The MSI is machine-wide and requires elevation.
- npm reported zero vulnerabilities. RustSec reported zero vulnerabilities after the SQLite upgrade and three advisory warnings for transitive dependencies.
- UI render and overflow checks ran in eight views at six widths. See [design and screenshots](DESIGN.md).

## Pending

- Elevated MSI install and uninstall, Windows 10 validation on an independent machine, and migration from an existing v0.3.0 installation.
- Pairing a real secondary account, reconnecting a linked session, and verifying sticker audio playback on receiving WhatsApp clients. Microphone capture also awaits an interactive hardware test.
- Network isolation for yt-dlp. Desktop social-platform downloads remain disabled. Direct HTTPS links and local files are available.
- Download percentage, quality selection and dedicated download cancellation. The current downloader provides status, limits, duration and final size.
- Full guided setup sequence, configurable process limits, autostart, tray, updater, hardware acceleration, hash cache, optional original retention and advanced bot options.
- Additional bot commands for text, outline, favorites and packs, sending individual pack stickers from the UI, and handset-compatible pack export.
