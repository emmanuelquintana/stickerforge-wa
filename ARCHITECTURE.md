# Architecture

The Tauri 2 process owns native file storage, SQLite, process supervision and the Windows session key. The renderer uses React with strict TypeScript. Its commands cover only application operations and there are no listening ports in the production app.

The Node worker receives one JSON work request over stdin. It invokes the same FFmpeg helpers as the retained bot and returns structured results. Local jobs are limited to eight queued or running and at most two concurrent conversions. Cancellation is sent through the worker pipe and terminates its FFmpeg child. Desktop previews use the same WebP encoder as export. The history records desktop exports and stores paths only under the application's data directory.

WhatsApp runs in its own managed Node process. Its private control channel carries configuration, state and QR events. Its desktop session uses AES-256-GCM with a per-user Windows DPAPI-protected key. The standalone Node bot remains available for development and migrated terminal users.

The installer carries Node and the bot dependencies. FFmpeg is fetched from a pinned third-party distribution by the built-in setup and verified by SHA-256. Local input copies and previews live under app-local scratch storage. The next startup clears that scratch directory. Exported files, packages and SQLite data are independent of application binaries.
