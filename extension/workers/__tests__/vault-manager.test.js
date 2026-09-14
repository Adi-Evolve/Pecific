import {
  unlockVault,
  lockVault,
  isUnlocked,
  setCredential,
  getCredential,
  getManifest
} from '../..//vault/vault-manager.js';

const storage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return { [key]: storage.get(key) };
        return Object.fromEntries(key.map((item) => [item, storage.get(item)]));
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
      }
    }
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`  PASS ${message}`);
};

lockVault();
assert(!isUnlocked(), 'vault starts locked');
await unlockVault('unit-test-passphrase');
assert(isUnlocked(), 'vault unlocks with a passphrase');
await setCredential('email', 'synthetic@example.invalid');
await setCredential('password', 'synthetic-secret');

const stored = storage.get('vault_data');
assert(stored.email && stored.password, 'credentials are persisted');
assert(!JSON.stringify(stored).includes('synthetic@example.invalid'), 'email plaintext is not persisted');
assert(!JSON.stringify(stored).includes('synthetic-secret'), 'password plaintext is not persisted');
assert(await getCredential('email') === 'synthetic@example.invalid', 'email decrypts correctly');
assert(await getCredential('password') === 'synthetic-secret', 'password decrypts correctly');

const manifest = await getManifest();
assert(manifest.locked === false, 'unlocked manifest reports unlocked');
assert(manifest.has_email === true && manifest.has_password === true, 'manifest exposes contract flags only');
lockVault();
const lockedManifest = await getManifest();
assert(lockedManifest.locked === true && lockedManifest.has_email === false, 'locked manifest hides fields');
console.log('Vault manager tests passed');
