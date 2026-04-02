// =============================================================
// SECURE PASSWORD HASHING — PBKDF2-SHA256
// Uses Web Crypto API (works in Edge Runtime + Node.js)
// =============================================================

const PBKDF2_ITERATIONS = 100_000; // OWASP recommended minimum
const SALT_LENGTH = 32; // 256-bit salt
const HASH_LENGTH = 64; // 512-bit derived key

/**
 * Generate a cryptographically random salt
 */
export function generateSalt() {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return bufToHex(salt);
}

/**
 * Hash a password with PBKDF2-SHA256
 * @param {string} password - Plain text password
 * @param {string} salt - Hex-encoded salt
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBuf(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8 // bits
  );

  return bufToHex(new Uint8Array(derivedBits));
}

/**
 * Verify a password against a stored hash
 * @param {string} password - Plain text password to verify
 * @param {string} storedHash - Hex-encoded stored hash
 * @param {string} salt - Hex-encoded salt
 * @returns {Promise<boolean>} true if password matches
 */
export async function verifyPassword(password, storedHash, salt) {
  const hash = await hashPassword(password, salt);
  // Constant-time comparison to prevent timing attacks
  if (hash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * HMAC-SHA256 signature for session tokens
 */
export async function signToken(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bufToHex(new Uint8Array(sig));
}

/**
 * Verify HMAC-SHA256 signature (constant-time)
 */
export async function verifySignature(payload, signature, secret) {
  const expected = await signToken(payload, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// --- Helpers ---
function bufToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
