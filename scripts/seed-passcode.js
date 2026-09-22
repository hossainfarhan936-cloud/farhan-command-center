// Seeds the dashboard passcode into D1 (same PBKDF2 params the Pages Function uses).
// Usage: node scripts/seed-passcode.js "<passcode>"  → prints the two SQL statements
import { webcrypto as crypto } from 'node:crypto';

const passcode = process.argv[2];
if (!passcode || passcode.length < 8) {
  console.error('Pass a passcode of at least 8 characters.');
  process.exit(1);
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const saltBytes = crypto.getRandomValues(new Uint8Array(16));
const salt = toHex(saltBytes);

const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' }, key, 256);
const hash = toHex(bits);

console.log("INSERT INTO settings (key, value) VALUES ('passcode_salt', '" + salt + "') ON CONFLICT(key) DO UPDATE SET value = excluded.value;");
console.log("INSERT INTO settings (key, value) VALUES ('passcode_hash', '" + hash + "') ON CONFLICT(key) DO UPDATE SET value = excluded.value;");