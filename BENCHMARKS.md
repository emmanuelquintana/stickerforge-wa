# Benchmarks

Windows x64, Node 24.19.0 and FFmpeg 9.1 Essentials. The comparison ran both source versions on the same machine, processing one generated 360 × 640 clip with a 440 Hz track for two seconds. Both used the same square crop, duration, 15 FPS ceiling and volume. One warm-up per engine was discarded. The order alternated across five measured pairs.

| Engine | Median end-to-end encode | WebP | Opus |
| --- | ---: | ---: | ---: |
| v0.3.0 | 596 ms | 223,212 B | 14,738 B |
| v0.4.0 | 608 ms | 223,212 B | 14,738 B |

Repeat the common encode benchmark with `node scripts/benchmark.mjs <path-to-v0.3.0-source>` after adding the same verified FFmpeg directory to PATH.

## Application startup and idle resources

Windows 11 build 26300. Both applications were measured on the same computer with the bot stopped.

| Measure | v0.3.0 Go launcher | v0.4.0 Tauri portable |
| --- | ---: | ---: |
| Startup to first visible UI | 228 ms median across five warm samples | 542 ms in one process-start-to-first-contentful-paint sample |
| Private memory shortly after launch | 13.51 MiB | 200.86 MiB across seven application and WebView2 processes |
| CPU over five seconds shortly after launch | 0.00% of one logical core | 1.54% of one logical core |

The old launcher stops at a console menu. The desktop app starts its renderer, interface and local database. The two startup observations use different readiness markers and sample counts. A second desktop sample after a preview and bot start/stop measured 384.96 MiB of private memory and 0.00% CPU, with eight processes still present. These measurements do not establish a performance improvement.
