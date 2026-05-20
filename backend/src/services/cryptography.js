import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { gcm } from '@noble/ciphers/aes';
import { hexToBytes } from '@noble/ciphers/utils';

const PBKDF2_ITERATIONS_PRODUCTION = 210000;
const PBKDF2_HASH = sha256;

const HEX_REGEX = /^[0-9a-fA-F]+$/;

const tryDecodeBase64 = (value) => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const buffer = Buffer.from(padded, 'base64');
    return buffer.length > 0 ? new Uint8Array(buffer) : null;
  } catch {
    return null;
  }
};

export const decodeSerializedBytesCandidates = (value, fieldName) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }

  const candidates = [];

  if (value.length % 2 === 0 && HEX_REGEX.test(value)) {
    candidates.push(hexToBytes(value));
  }

  const decoded = tryDecodeBase64(value);
  if (decoded) {
    const alreadyIncluded = candidates.some((candidate) => {
      if (candidate.length !== decoded.length) return false;
      for (let i = 0; i < candidate.length; i += 1) {
        if (candidate[i] !== decoded[i]) return false;
      }
      return true;
    });

    if (!alreadyIncluded) {
      candidates.push(decoded);
    }
  }

  if (candidates.length > 0) {
    return candidates;
  }

  throw new Error(`Invalid ${fieldName}: unsupported encoding`);
};

const decodeBytes = (value, fieldName) => decodeSerializedBytesCandidates(value, fieldName)[0];

const KDF_HASHES = {
  sha256,
  sha512,
};

const resolvePbkdf2Hash = (kdfHint) => {
  if (typeof kdfHint !== 'string' || !kdfHint) {
    return PBKDF2_HASH;
  }

  const normalized = kdfHint.toLowerCase();
  if (normalized.includes('sha512')) {
    return KDF_HASHES.sha512;
  }

  return KDF_HASHES.sha256;
};

/**
 * Derives a 256-bit key from password using PBKDF2-SHA256
 * @param {string} password - The user's password
 * @param {string} saltHex - Salt as hex string
 * @param {number} iterations - PBKDF2 iterations count
 * @returns {Uint8Array} 32-byte derived key
 */
export const deriveKeyFromPassword = (
  password,
  saltSerialized,
  iterations = PBKDF2_ITERATIONS_PRODUCTION,
  kdfHint,
) => {
  const salt = decodeBytes(saltSerialized, 'salt');
  return deriveKeyFromPasswordBytes(password, salt, iterations, kdfHint);
};

/**
 * Derives a key using already-decoded salt bytes (bypasses hex/base64 decoding).
 * Use when the salt is already in binary form or needs to be passed as raw string bytes.
 */
export const deriveKeyFromPasswordBytes = (
  password,
  saltBytes,
  iterations = PBKDF2_ITERATIONS_PRODUCTION,
  kdfHint,
) => {
  const key = pbkdf2(resolvePbkdf2Hash(kdfHint), password, saltBytes, {
    c: iterations,
    dkLen: 32,
  });
  return key;
};

/**
 * Decrypts AES-256-GCM ciphertext
 * @param {Uint8Array} key - 32-byte key
 * @param {string} nonceSerialized - 96-bit nonce as hex/base64 string
 * @param {string} ciphertextSerialized - Ciphertext as hex/base64 string
 * @param {string} authTagSerialized - Authentication tag as hex/base64 string
 * @returns {string} Decrypted plaintext
 */
export const decryptAES256GCM = (
  key,
  nonceSerialized,
  ciphertextSerialized,
  authTagSerialized,
) => {
  const plaintextBytes = decryptAES256GCMToBytes(
    key,
    nonceSerialized,
    ciphertextSerialized,
    authTagSerialized,
  );
  return new TextDecoder().decode(plaintextBytes);
};

/**
 * Decrypts AES-256-GCM ciphertext and returns raw plaintext bytes
 * @param {Uint8Array} key - 32-byte key
 * @param {string} nonceSerialized - 96-bit nonce as hex/base64 string
 * @param {string} ciphertextSerialized - Ciphertext as hex/base64 string
 * @param {string} authTagSerialized - Authentication tag as hex/base64 string
 * @returns {Uint8Array} Decrypted plaintext bytes
 */
export const decryptAES256GCMToBytes = (
  key,
  nonceSerialized,
  ciphertextSerialized,
  authTagSerialized,
  options = {},
) => {
  const {
    aadCandidates = [],
    ciphertextMayIncludeTag = false,
  } = options;

  const nonceCandidates = decodeSerializedBytesCandidates(nonceSerialized, 'nonce');
  const ciphertextCandidates = decodeSerializedBytesCandidates(
    ciphertextSerialized,
    'ciphertext',
  );
  const authTagCandidates = decodeSerializedBytesCandidates(authTagSerialized, 'authTag');

  const aadBytesCandidates = [undefined];
  for (const aadCandidate of aadCandidates) {
    if (!aadCandidate) continue;

    if (aadCandidate instanceof Uint8Array) {
      aadBytesCandidates.push(aadCandidate);
      continue;
    }

    if (typeof aadCandidate === 'string') {
      aadBytesCandidates.push(new TextEncoder().encode(aadCandidate));
    }
  }

  let lastError;

  for (const nonce of nonceCandidates) {
    for (const ciphertext of ciphertextCandidates) {
      for (const authTag of authTagCandidates) {
        const combined = new Uint8Array(ciphertext.length + authTag.length);
        combined.set(ciphertext);
        combined.set(authTag, ciphertext.length);

        for (const aad of aadBytesCandidates) {
          try {
            const cipher = gcm(key, nonce, aad);
            return cipher.decrypt(combined);
          } catch (error) {
            lastError = error;
          }

          if (ciphertextMayIncludeTag && ciphertext.length >= 16) {
            try {
              const cipher = gcm(key, nonce, aad);
              return cipher.decrypt(ciphertext);
            } catch (error) {
              lastError = error;
            }
          }
        }
      }
    }
  }

  throw lastError || new Error('aes/gcm: failed to decrypt with available encodings');
};
