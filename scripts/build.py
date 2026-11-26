"""Build the Windows x64 bootstrap executable with embedded source (no dependencies bundled)."""
from pathlib import Path
import os, subprocess, zipfile, hashlib
root = Path(__file__).resolve().parents[1]
with zipfile.ZipFile(root/'launcher/payload.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in [root/'package.json',root/'.env.example',root/'LICENSE',root/'NOTICE.md',root/'desktop/auth.mjs',*sorted((root/'src').glob('*.mjs'))]:
        z.write(p,p.relative_to(root).as_posix())
    if (root/'package-lock.json').exists(): z.write(root/'package-lock.json','package-lock.json')
(root/'dist').mkdir(exist_ok=True)
out=root/'dist/StickerForge-WA-Setup-x64.exe'
subprocess.run(['go','build','-trimpath','-ldflags=-s -w -buildid=','-o',str(out),'.'],cwd=root/'launcher',env={**os.environ,'GOOS':'windows','GOARCH':'amd64','CGO_ENABLED':'0'},check=True)
(root/'dist/SHA256SUMS.txt').write_text(f'{hashlib.sha256(out.read_bytes()).hexdigest()}  {out.name}\n')
