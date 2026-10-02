// The editing key and the password that unlocks it.
//
// Jonah creates a GitHub token that can only change this one repository. The
// setup screen encrypts it with a passphrase and stores the result as
// admin/key.json on the site. Typing the passphrase decrypts the token in the
// browser; the token itself is never stored on the site in readable form.
// AES-GCM with a key from PBKDF2-SHA256 (1,000,000 iterations, random salt).

import { WORDS } from './wordlist.js';

const ITERATIONS = 1_000_000;
const TOKEN_KEY = 'site-editor-token';
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// Forgiving about case, spaces and dashes: "Maple River" == "maple-river".
export function normalizePassphrase(p) {
  return String(p || '').trim().toLowerCase().replace(/[\s_\-–—.]+/g, '-').replace(/^-|-$/g, '');
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptToken(token, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)));
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
    created: new Date().toISOString(),
  };
}

// Throws an Error with code 'WRONG_PASSWORD' when the passphrase does not fit.
export async function decryptToken(file, passphrase) {
  const key = await deriveKey(passphrase, fromB64(file.salt), file.iterations || ITERATIONS);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data));
    return dec.decode(plain);
  } catch {
    const err = new Error("That password didn't work. Check for typos and try again.");
    err.code = 'WRONG_PASSWORD';
    throw err;
  }
}

// Five words from a 1,024-word list: about 50 bits, far beyond guessing even
// with the encrypted key in hand (each guess costs a million PBKDF2 rounds).
export function generatePassphrase(count = 5) {
  if (WORDS.length !== 1024) throw new Error('word list must have 1024 entries');
  const nums = crypto.getRandomValues(new Uint16Array(count));
  return Array.from(nums, n => WORDS[n & 1023]).join('-');
}

// Rough strength check for a passphrase someone types in themselves.
export function passphraseProblem(p) {
  const n = normalizePassphrase(p);
  if (n.length < 16) return 'Use at least 16 characters (four or more words is easiest).';
  if (n.split('-').length < 3 && n.length < 24) return 'Use at least three words, or 24 characters.';
  return '';
}

// ---------- remembering the token on this computer ----------

export function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// True when the key was kept for this computer ("Remember me"), false when it
// is kept for this browser tab only.
export function tokenRemembered() {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

export function storeToken(token, remember) {
  try {
    forgetToken();
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    // Storage blocked: the token stays in memory for this visit only.
  }
}

export function forgetToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}
