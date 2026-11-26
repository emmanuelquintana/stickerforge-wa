import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { run, webpInfo, probe } from '../src/media.mjs';
import { encryptedAuth } from '../desktop/auth.mjs';

async function worker(request, { cancel = false } = {}) {
  const process = spawn(globalThis.process.execPath, ['desktop/worker.mjs'], { windowsHide: true });
  const chunks = [];
  process.stdout.on('data', chunk => chunks.push(chunk));
  process.stdin.on('error', () => {});
  process.stdin.write(JSON.stringify(request) + '\n');
  if (cancel) setTimeout(() => process.stdin.write('cancel\n'), 120);
  const [code] = await once(process, 'close');
  return { code, result: JSON.parse(Buffer.concat(chunks)) };
}

test('worker exports animated square video and synchronized audio from a horizontal clip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-desktop-'));
  try {
    const input = join(dir, 'source.mp4');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', input]);
    const request = { action: 'sticker', input, dir, options: { mode: 'blur', start: .2, duration: 1.5, speed: 1.5, sound: true, fps: 15 } };
    if (process.platform === 'win32') request.options.caption = 'Prueba 100% : [texto]';
    const { result, code } = await worker(request);
    assert.equal(code, 0, result.error);
    const [webp, audio] = result.files;
    const info = webpInfo(await readFile(webp));
    assert.equal(info.width, 512);
    assert.equal(info.height, 512);
    assert.ok(info.frames > 5);
    assert.ok(Math.abs((await probe(audio)).duration - info.duration) < .08);
    assert.ok((await readFile(webp)).byteLength <= 512000);
    assert.equal((await worker({ action: 'probe', input, options: { waveform: true } })).result.peaks.length, 96);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('worker preserves transparent stills and validates direct-only downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-alpha-'));
  try {
    const input = join(dir, 'source.png');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red@0.5:s=200x300,format=rgba', '-frames:v', '1', input]);
    const { code, result } = await worker({ action: 'sticker', input, dir, options: { mode: 'transparente', rotation: 90 } });
    assert.equal(code, 0, result.error);
    const asset = await readFile(result.files[0]);
    assert.ok(asset.includes(Buffer.from('ALPH')));
    assert.equal(webpInfo(asset).width, 512);
    const privateLink = await worker({ action: 'download', url: 'https://192.168.1.25/a.mp4', dir });
    assert.equal(privateLink.code, 1);
    const platformLink = await worker({ action: 'download', url: 'https://youtu.be/abcdefghijk', dir });
    assert.match(platformLink.result.error, /aislamiento/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('worker stops its multimedia child when cancellation is received', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-cancel-'));
  try {
    const input = join(dir, 'source.mp4');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', input]);
    const { code, result } = await worker({ action: 'sticker', input, dir, options: { duration: 3, fps: 30, mode: 'blur' } }, { cancel: true });
    assert.equal(code, 1);
    assert.match(result.error, /cancelada/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('desktop authentication encrypts stored credentials and rejects a different key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-auth-'));
  try {
    const key = Buffer.alloc(32, 5);
    const api = { BufferJSON: {}, initAuthCreds: () => ({ secret: 'fixture-credential' }) };
    const auth = await encryptedAuth(dir, key, api);
    await auth.saveCreds();
    await auth.state.keys.set({ 'pre-key': { fixture: { value: 1 } } });
    assert.ok(!(await readFile(join(dir, 'state.bin'))).includes(Buffer.from(auth.state.creds.secret)));
    const loaded = await encryptedAuth(dir, key, api);
    assert.deepEqual(await loaded.state.keys.get('pre-key', ['fixture']), { fixture: { value: 1 } });
    await assert.rejects(encryptedAuth(dir, Buffer.alloc(32, 6), api));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
