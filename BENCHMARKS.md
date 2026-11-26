# Benchmarks

Windows x64, Node 24.19.0 and FFmpeg 9.1 Essentials. The comparison ran both source versions on the same machine, processing one generated 360 × 640 clip with a 440 Hz track for two seconds. Both used the same square crop, duration, 15 FPS ceiling and volume. One warm-up per engine was discarded. The order alternated across five measured pairs.

| Engine | Median end-to-end encode | WebP | Opus |
| --- | ---: | ---: | ---: |
| v0.3.0 | 596 ms | 223,212 B | 14,738 B |
| v0.4.0 | 608 ms | 223,212 B | 14,738 B |

The benchmark covers the common encode path. Repeat with `node scripts/benchmark.mjs <path-to-v0.3.0-source>` after adding the same verified FFmpeg directory to PATH. This run does not measure WebView startup, idle CPU, idle memory or WhatsApp traffic.
