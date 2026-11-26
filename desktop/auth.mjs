import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function encryptedAuth(directory, key, { BufferJSON, initAuthCreds, proto }) {
  const cache = await load() || { creds: initAuthCreds(), keys: {} };
  let tail = Promise.resolve();
  function persist() {
    const payload = JSON.stringify(cache, BufferJSON.replacer);
    const save = tail.catch(() => {}).then(async () => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
      const temporary = join(directory, randomUUID() + '.tmp');
      try {
        await writeFile(temporary, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { flag: 'wx', mode: 0o600 });
        await rename(temporary, join(directory, 'state.bin'));
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
    tail = save;
    return save;
  }
  async function load() {
    let bytes;
    try {
      bytes = await readFile(join(directory, 'state.bin'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]), BufferJSON.reviver);
  }
  return {
    state: {
      creds: cache.creds,
      keys: {
        async get(type, ids) {
          return Object.fromEntries(ids.map(id => {
            const data = cache.keys[type]?.[id];
            return [id, type === 'app-state-sync-key' && data ? proto.Message.AppStateSyncKeyData.fromObject(data) : data];
          }));
        },
        async set(updates) {
          for (const [type, values] of Object.entries(updates)) {
            cache.keys[type] ??= {};
            for (const [id, value] of Object.entries(values)) {
              if (value == null) delete cache.keys[type][id];
              else cache.keys[type][id] = value;
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
    flush: () => tail,
  };
}
