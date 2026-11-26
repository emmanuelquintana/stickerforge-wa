import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeAudio, makeSticker, run } from '../src/media.mjs';

if (!process.argv[2]) throw new Error('Pass the path to the extracted v0.3.0 source directory.');
const legacy = await import(pathToFileURL(resolve(process.argv[2], 'src/media.mjs')));
const dir = await mkdtemp(join(tmpdir(), 'sf-bench-'));
const options = { mode: 'corte', x: 50, y: 50, start: 0, duration: 2, fps: 15, volume: 100 };
try {
  const input = join(dir, 'fixture.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', input]);
  const rows = [];
  for (let trial = 0; trial < 6; trial++) {
    const order = trial % 2 ? ['current', 'legacy'] : ['legacy', 'current'];
    for (const version of order) {
      const engine = version === 'legacy' ? legacy : { makeSticker, makeAudio };
      const start = performance.now();
      const video = await engine.makeSticker(input, dir, options);
      const audio = await engine.makeAudio(input, dir, options, { duration: video.duration, pad: true });
      const timeMs = Math.round(performance.now() - start);
      if (trial) rows.push({ version, timeMs, webpBytes: video.bytes, opusBytes: (await stat(audio)).size });
    }
  }
  console.table(rows);
  for (const version of ['legacy', 'current']) {
    const times = rows.filter(row => row.version === version).map(row => row.timeMs).sort((a, b) => a - b);
    console.log(version, 'median', times[Math.floor(times.length / 2)], 'ms');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
