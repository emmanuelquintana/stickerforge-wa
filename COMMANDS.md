# WhatsApp commands

Send a supported file with the command as its caption, reply to an attached file, or provide a direct HTTPS video link. A standalone direct link uses the behavior of `!a`.

| Command | Output |
| --- | --- |
| `!a` | Animated WebP and experimental attached Opus audio |
| `!s` | Silent sticker |
| `!mezclar` | Pair a picture or video with a second message containing audio |
| `!audio` | MP3 audio |
| `!voz` | Ogg/Opus voice note |
| `!gif` | Silent loop as a WhatsApp GIF-playback video |
| `!foto` | Still frame |
| `!video` | MP4 video |
| `!cancelar` | Cancel a pending mix or a queued or running conversion |
| `!ayuda`, `!menu` | Help |
| `!estado`, `!config` | Bot status and current policy |
| `!recorte`, `!invertir` | Silent sticker with crop or horizontal flip |
| `!lento`, `!rapido` | Sound sticker at 0.75× or 1.5× |
| `!volumen`, `!efecto` | Sound sticker with volume or a voice effect |

Example using the existing advanced syntax:

```text
!a https://example.com/video.mp4 inicio=10 dur=5 y=20 vol=150 fps=15
```

Use `modo=corte`, `modo=completo` or `modo=negro` for square crop, transparent fit or black fit.
