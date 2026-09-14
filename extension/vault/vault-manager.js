const PBKDF2_ITERATIONS = 250000;
let derivedKey = null;

async function deriveKeyFromPassphrase(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function unlockVault(passphrase) {
  let saltRecord = await chrome.storage.local.get("vault_salt");
  let salt;
  if (!saltRecord.vault_salt) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    await chrome.storage.local.set({ vault_salt: Array.from(salt) });
  } else {
    salt = new Uint8Array(saltRecord.vault_salt);
  }
  derivedKey = await deriveKeyFromPassphrase(passphrase, salt);
  return true;
}

function lockVault() { derivedKey = null; }
function isUnlocked() { return derivedKey !== null; }

async function setCredential(fieldName, plaintextValue) {
  if (!isUnlocked()) throw new Error("Vault is locked — call unlockVault() first");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derivedKey, enc.encode(plaintextValue));
  const record = await chrome.storage.local.get("vault_data");
  const vault_data = record.vault_data || {};
  vault_data[fieldName] = { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
  await chrome.storage.local.set({ vault_data });
}

async function getCredential(fieldName) {
  if (!isUnlocked()) throw new Error("Vault is locked — call unlockVault() first");
  const record = await chrome.storage.local.get("vault_data");
  const entry = record.vault_data?.[fieldName];
  if (!entry) return null;
  const iv = new Uint8Array(entry.iv);
  const ciphertext = new Uint8Array(entry.ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, derivedKey, ciphertext);
  return new TextDecoder().decode(plainBuf);
}

async function getManifest() {
  const record = await chrome.storage.local.get("vault_data");
  const stored = record.vault_data || {};
  if (!isUnlocked()) {
    return {
      has_email: false,
      has_password: false,
      has_phone: false,
      has_card: false,
      has_aadhaar: false,
      has_pan: false,
      locked: true
    };
  }
  const available = new Set(Object.keys(stored).map((key) => key.toLowerCase()));
  return {
    has_email: available.has("email"),
    has_password: available.has("password"),
    has_phone: available.has("phone"),
    has_card: available.has("card"),
    has_aadhaar: available.has("aadhaar"),
    has_pan: available.has("pan"),
    locked: false
  };
}

export { unlockVault, lockVault, isUnlocked, setCredential, getCredential, getManifest };