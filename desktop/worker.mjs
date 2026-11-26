import { copyFile, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { makeSticker, makeAudio, probe, run, waveform, exportVideo } from '../src/media.mjs';
import { downloadLink } from '../src/links.mjs';
import { installToolkit } from './toolkit.mjs';

const abort = new AbortController();
const messages = createInterface({ input: process.stdin });
const [message] = await once(messages, 'line');
messages.on('line', () => abort.abort());
messages.on('close', () => abort.abort());
const { action, input, audio, dir, url, options: raw } = JSON.parse(message);
const signal = abort.signal;
const number = (value, min, max, fallback) => Number.isFinite(value)
  ? Math.min(max, Math.max(min, value))
  : fallback;
const options = {
  start: number(raw?.start, 0, 3600, 0),
  duration: number(raw?.duration, 0.1, 25, 5),
  volume: number(raw?.volume, 0, 200, 100),
  speed: number(raw?.speed, 0.5, 2, 1),
  fps: Math.round(number(raw?.fps, 5, 30, 15)),
  quality: Math.round(number(raw?.quality, 5, 95, 75)),
  x: number(raw?.x, 0, 100, 50),
  y: number(raw?.y, 0, 100, 50),
  zoom: number(raw?.zoom, 1, 3, 1),
  rotation: [0, 90, 180, 270].includes(raw?.rotation) ? raw.rotation : 0,
  flip: raw?.flip === true,
  brightness: number(raw?.brightness, -0.5, 0.5, 0),
  contrast: number(raw?.contrast, 0.5, 2, 1),
  saturation: number(raw?.saturation, 0, 2, 1),
  mode: ['corte', 'transparente', 'negro', 'blanco', 'color', 'blur'].includes(raw?.mode) ? raw.mode : 'corte',
  color: typeof raw?.color === 'string' && /^#[\da-f]{6}$/i.test(raw.color) ? raw.color : '#151917',
  sound: raw?.sound === true,
  format: raw?.format === 'mp3' ? 'mp3' : 'opus',
  fadeIn: number(raw?.fadeIn, 0, 10, 0),
  fadeOut: number(raw?.fadeOut, 0, 10, 0),
  normalize: raw?.normalize === true,
  pitch: number(raw?.pitch, -12, 12, 0),
  removeSilence: raw?.removeSilence === true,
  effect: ['radio', 'echo'].includes(raw?.effect) ? raw.effect : '',
  caption: typeof raw?.caption === 'string' ? [...raw.caption.replace(/[\r\n]/g, ' ')].slice(0, 64).join('') : '',
  outline: number(raw?.outline, 0, 8, 3),
};
try {
  if (action === 'install') {
    await installToolkit(dir, signal);
    process.stdout.write('{}');
  } else if (action === 'probe' || action === 'download') {
    let path = input;
    if (action === 'download') {
      await mkdir(dir, { recursive: true });
      path = join(dir, 'video.bin');
    }
    const info = action === 'download'
      ? await downloadLink(url, path, { signal, directOnly: true })
      : await probe(path, { signal });
    if (action === 'download') {
      const video = await exportVideo(path, dir, { signal });
      await unlink(path);
      path = video;
    }
    process.stdout.write(JSON.stringify({
      path,
      bytes: (await stat(path)).size,
      duration: info.duration,
      width: info.video?.width,
      height: info.video?.height,
      hasAudio: Boolean(info.audio),
      still: Boolean(info.video && !info.duration && (info.video.codec_name !== 'gif')),
      peaks: info.audio && raw?.waveform === true ? await waveform(path, { signal }).catch(() => []) : undefined,
    }));
  } else if (action === 'diagnose') {
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']);
    await run(process.env.FFPROBE_PATH || 'ffprobe', ['-version']);
    process.stdout.write('{}');
  } else {
    await mkdir(dir, { recursive: true });
    const info = await probe(input, { signal });
    const still = !!info.video && !info.duration && info.video.codec_name !== 'gif';
    if (action === 'audio') {
      const file = await makeAudio(input, dir, options, { mp3: options.format === 'mp3', signal });
      process.stdout.write(JSON.stringify({ files: [file], bytes: (await stat(file)).size }));
    } else if (action === 'sticker') {
      if (options.caption) {
        await copyFile(join(process.env.SystemRoot || 'C:\\Windows', 'Fonts', 'segoeui.ttf'), join(dir, 'caption.ttf'));
        await writeFile(join(dir, 'caption.txt'), options.caption);
      }
      const result = await makeSticker(input, dir, options, { still, signal });
      if (options.caption) {
        await unlink(join(dir, 'caption.ttf'));
        await unlink(join(dir, 'caption.txt'));
      }
      const files = [result.path];
      let bytes = result.bytes;
      if (options.sound) {
        const source = audio || input;
        const sound = await makeAudio(source, dir, audio ? { ...options, start: 0 } : options, {
          duration: still || !result.animated ? options.duration : result.duration,
          pad: true, signal,
        });
        files.push(sound);
        bytes += (await stat(sound)).size;
      }
      process.stdout.write(JSON.stringify({ files, bytes }));
    } else {
      throw new Error('Operación desconocida');
    }
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : 'Error de procesamiento' }));
  process.exitCode = 1;
} finally {
  messages.close();
  process.stdin.pause();
}
