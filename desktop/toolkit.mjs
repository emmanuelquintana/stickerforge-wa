import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from '../src/media.mjs';

const archiveName = 'ffmpeg-9.1-essentials_build';
const hash = 'b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd';
const root = join(process.env.SystemRoot || 'C:\\Windows', 'System32');

async function verify(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  if (digest.digest('hex') !== hash) throw new Error('La suma SHA-256 de FFmpeg no coincide');
}

export async function installToolkit(dir, signal) {
  if (process.platform !== 'win32') throw new Error('El asistente de FFmpeg requiere Windows');
  await mkdir(dir, { recursive: true });
  const scratch = await mkdtemp(join(dir, '.install-'));
  const archive = join(scratch, 'ffmpeg.zip');
  try {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(240000)]);
    const response = await fetch(`https://www.gyan.dev/ffmpeg/builds/packages/${archiveName}.zip`, { signal: timeout, redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('No se pudo descargar FFmpeg');
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > 150 * 1024 * 1024 ? new Error('El archivo excede el límite de descarga') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archive, { flags: 'wx' }), { signal: timeout });
    await verify(archive);
    await run(join(root, 'tar.exe'), ['-xf', archive, '-C', scratch,
      `${archiveName}/bin/ffmpeg.exe`, `${archiveName}/bin/ffprobe.exe`, `${archiveName}/LICENSE`], { signal });
    await mkdir(join(dir, 'ready'), { recursive: true });
    await Promise.all([
      rename(join(scratch, archiveName, 'bin', 'ffmpeg.exe'), join(dir, 'ready', 'ffmpeg.exe')),
      rename(join(scratch, archiveName, 'bin', 'ffprobe.exe'), join(dir, 'ready', 'ffprobe.exe')),
      rename(join(scratch, archiveName, 'LICENSE'), join(dir, 'ready', 'FFmpeg-LICENSE.txt')),
    ]);
    if (!(await stat(join(dir, 'ready', 'ffmpeg.exe'))).size) throw new Error('FFmpeg no se instaló');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
