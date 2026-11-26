import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/media.mjs';

const archiveName = 'ffmpeg-9.1-essentials_build';
const hash = 'b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd';
const root = join(process.env.SystemRoot || 'C:\\Windows', 'System32');

async function verify(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  if (digest.digest('hex') !== hash) throw new Error('La suma SHA-256 de FFmpeg no coincide');
}

export async function installToolkit(dir, signal, localArchive) {
  if (process.platform !== 'win32') throw new Error('El asistente de FFmpeg requiere Windows');
  await mkdir(dir, { recursive: true });
  const scratch = await mkdtemp(join(dir, '.install-'));
  const archive = join(scratch, 'ffmpeg.zip');
  try {
    if (localArchive) {
      const info = await stat(localArchive);
      if (!info.isFile() || info.size > 150 * 1024 * 1024) throw new Error('Selecciona el ZIP de FFmpeg verificado');
      await copyFile(localArchive, archive);
    } else {
      const url = `https://github.com/GyanD/codexffmpeg/releases/download/9.1/${archiveName}.zip`;
      try {
        await run(join(root, 'curl.exe'), [
          '--disable', '--fail', '--silent', '--show-error', '--location', '--max-redirs', '2',
          '--proto', '=https', '--proto-redir', '=https', '--max-filesize', '157286400',
          '--connect-timeout', '15', '--speed-time', '20', '--speed-limit', '1024',
          '--max-time', '180', '--output', archive, url,
        ], { signal, timeout: 185000 });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error('No se pudo descargar FFmpeg. Intenta de nuevo o selecciona el ZIP verificado desde Configuración.');
      }
    }
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
