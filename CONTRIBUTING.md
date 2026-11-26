# Contributing

Use Node.js 24 LTS, Rust with the Windows MSVC target and WebView2. Install the locked npm dependencies with `npm ci`. On Windows, `scripts/stage-windows.ps1` prepares the verified redistributable engine. Run the TypeScript build, `npm test`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --locked` before submitting changes.

Use generated or publicly licensed fixtures. Keep credentials, QR images, session state, personal media and local databases out of commits, test output and issue reports.
