import {
  deriveKeyFromPassword,
  deriveKeyFromPasswordBytes,
  decryptAES256GCM,
  decryptAES256GCMToBytes,
} from './cryptography.js';
import {
  EncryptedBackupEnvelopeSchema,
  BackupPayloadSchema,
} from '../db/schemas.js';

const HEX_REGEX = /^[0-9a-fA-F]+$/;

// Fixed AAD used by the mobile app for BOTH wrappedMasterKey and outer payload.
// Source: NativeBudgetBlade/mobile/services/master-key.service.ts → WRAP_AAD
const MOBILE_APP_AAD = 'NativeBudgetBlade:MEK:wrap:v1';

const decodeSerializedKey = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (value.length % 2 === 0 && HEX_REGEX.test(value)) {
    const out = new Uint8Array(value.length / 2);
    for (let i = 0; i < value.length; i += 2) {
      out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
    }
    return out;
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = new Uint8Array(Buffer.from(padded, 'base64'));
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
};

const parseMasterKeyBytes = (plaintextBytes) => {
  if (plaintextBytes.length === 32) {
    return plaintextBytes;
  }

  const decodedText = new TextDecoder().decode(plaintextBytes).trim();
  if (!decodedText) {
    return null;
  }

  const directKey = decodeSerializedKey(decodedText);
  if (directKey?.length === 32) {
    return directKey;
  }

  try {
    const parsed = JSON.parse(decodedText);
    const candidate =
      parsed?.masterKey || parsed?.master_key || parsed?.key || parsed?.mek;

    const parsedKey = decodeSerializedKey(candidate);
    if (parsedKey?.length === 32) {
      return parsedKey;
    }
  } catch {
    // Not JSON, ignore.
  }

  return null;
};

const buildIterationCandidates = (wrappedIterations) => {
  const rawCandidates = [wrappedIterations, 210000, 5000];
  const unique = new Set();

  for (const value of rawCandidates) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      unique.add(parsed);
    }
  }

  return Array.from(unique);
};

const buildPasswordCandidates = (password) => {
  const raw = String(password ?? '');
  const candidates = [raw];

  const normalized = [
    raw.normalize('NFC'),
    raw.normalize('NFD'),
    raw.normalize('NFKC'),
    raw.normalize('NFKD'),
  ];

  for (const candidate of normalized) {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  const trimmed = raw.trim();
  if (trimmed && !candidates.includes(trimmed)) {
    candidates.push(trimmed);
  }

  return candidates;
};

const buildWrappedAADCandidates = (wrappedMasterKey) => {
  const metadataOnly = {
    version: wrappedMasterKey.version,
    algorithm: wrappedMasterKey.algorithm,
    kdf: wrappedMasterKey.kdf,
    iterations: wrappedMasterKey.iterations,
    salt: wrappedMasterKey.salt,
  };

  return [
    wrappedMasterKey.kdf,
    wrappedMasterKey.algorithm,
    JSON.stringify(metadataOnly),
    JSON.stringify(wrappedMasterKey),
    `${wrappedMasterKey.version}:${wrappedMasterKey.algorithm}:${wrappedMasterKey.kdf}:${wrappedMasterKey.iterations}:${wrappedMasterKey.salt}`,
  ];
};

/**
 * Decrypts .nbb backup file and returns validated payload
 * @param {string} fileContent - Raw file content (JSON string)
 * @param {string} password - User's password for unwrapping master key
 * @returns {Promise<Object>} Validated backup payload with tables
 * @throws {Error} If decryption or validation fails
 */
export const decryptNBBBackup = async (fileContent, password) => {
  let envelope;

  // Parse the JSON envelope
  try {
    envelope = JSON.parse(fileContent);
  } catch (error) {
    throw new Error('Invalid .nbb file format: not valid JSON');
  }

  // Validate envelope structure
  const envelopeValidation = EncryptedBackupEnvelopeSchema.safeParse(envelope);
  if (!envelopeValidation.success) {
    throw new Error(
      `Invalid .nbb envelope: ${envelopeValidation.error.issues[0]?.message || 'schema validation failed'}`,
    );
  }

  const { nonce, ciphertext, authTag, wrappedMasterKey } =
    envelopeValidation.data;

  if (!wrappedMasterKey) {
    throw new Error('Cannot decrypt: missing wrappedMasterKey in backup');
  }

  if (!password) {
    throw new Error('Password is required to decrypt .nbb backup');
  }

  let decryptedJson;

  // Log diagnostic info (non-sensitive) to help identify encoding format
  console.log('[CRYPTO] wrappedMasterKey metadata:', {
    version: wrappedMasterKey.version,
    algorithm: wrappedMasterKey.algorithm,
    kdf: wrappedMasterKey.kdf,
    iterations: wrappedMasterKey.iterations,
    saltLen: wrappedMasterKey.salt?.length,
    nonceLen: wrappedMasterKey.nonce?.length,
    ciphertextLen: wrappedMasterKey.ciphertext?.length,
    authTagLen: wrappedMasterKey.authTag?.length,
    saltSample: wrappedMasterKey.salt?.substring(0, 6),
    saltIsHex: /^[0-9a-fA-F]+$/.test(wrappedMasterKey.salt ?? ''),
    saltIsBase64: /^[A-Za-z0-9+/=]+$/.test(wrappedMasterKey.salt ?? ''),
  });
  console.log('[CRYPTO] outer envelope metadata:', {
    nonceLen: nonce?.length,
    ciphertextLen: ciphertext?.length,
    authTagLen: authTag?.length,
  });

  const keyEncryptionKeys = [];
  const iterationsToTry = buildIterationCandidates(wrappedMasterKey.iterations);
  const passwordsToTry = buildPasswordCandidates(password);

  const kdfHintsToTry = [
    wrappedMasterKey.kdf,
    'PBKDF2-SHA256',
    'PBKDF2-SHA512',
  ];

  // Raw salt as UTF-8 string bytes (some mobile implementations pass the salt
  // string directly to PBKDF2 without decoding from hex/base64 first).
  const rawSaltAsUTF8 = new TextEncoder().encode(wrappedMasterKey.salt);

  for (const candidatePassword of passwordsToTry) {
    for (const iterations of iterationsToTry) {
      for (const kdfHint of kdfHintsToTry) {
        // Standard: decode salt from hex/base64 then derive
        try {
          keyEncryptionKeys.push(
            deriveKeyFromPassword(candidatePassword, wrappedMasterKey.salt, iterations, kdfHint),
          );
        } catch {
          // ignore
        }

        // Fallback: salt passed as raw UTF-8 string bytes (no hex/base64 decoding)
        try {
          keyEncryptionKeys.push(
            deriveKeyFromPasswordBytes(candidatePassword, rawSaltAsUTF8, iterations, kdfHint),
          );
        } catch {
          // ignore
        }
      }
    }
  }

  if (keyEncryptionKeys.length === 0) {
    throw new Error('Unable to derive decryption key from provided password metadata');
  }

  const decryptionErrors = [];
  try {
    for (const keyEncryptionKey of keyEncryptionKeys) {
      // AAD candidates: mobile app's fixed AAD is tried first, then dynamic fallbacks.
      const wrapAadCandidates = [MOBILE_APP_AAD, ...buildWrappedAADCandidates(wrappedMasterKey)];
      const outerAadCandidates = [MOBILE_APP_AAD];

      // Strategy A (legacy): payload encrypted directly with KEK.
      try {
        const plainBytes = decryptAES256GCMToBytes(
          keyEncryptionKey,
          nonce,
          ciphertext,
          authTag,
          { aadCandidates: outerAadCandidates },
        );
        decryptedJson = new TextDecoder().decode(plainBytes);
        break;
      } catch (directError) {
        decryptionErrors.push(`direct payload decrypt failed: ${directError.message}`);
      }

      // Strategy B (current): unwrap MEK first, then decrypt payload.
      try {
        const unwrappedMasterKeyBytes = decryptAES256GCMToBytes(
          keyEncryptionKey,
          wrappedMasterKey.nonce,
          wrappedMasterKey.ciphertext,
          wrappedMasterKey.authTag,
          {
            aadCandidates: wrapAadCandidates,
            ciphertextMayIncludeTag: true,
          },
        );

        const masterKey = parseMasterKeyBytes(unwrappedMasterKeyBytes);
        if (!masterKey) {
          throw new Error('unwrapped master key format is invalid');
        }

        const outerPlainBytes = decryptAES256GCMToBytes(
          masterKey,
          nonce,
          ciphertext,
          authTag,
          { aadCandidates: outerAadCandidates },
        );
        decryptedJson = new TextDecoder().decode(outerPlainBytes);
        break;
      } catch (wrappedError) {
        decryptionErrors.push(`wrapped key flow failed: ${wrappedError.message}`);
      }
    }

    if (!decryptedJson) {
      throw new Error(
        decryptionErrors[decryptionErrors.length - 1] ||
          'all decryption strategies failed',
      );
    }
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }

  let payload;

  // Parse decrypted JSON
  try {
    payload = JSON.parse(decryptedJson);
  } catch (error) {
    throw new Error('Decryption succeeded but result is not valid JSON');
  }

  // Validate payload structure
  const payloadValidation = BackupPayloadSchema.safeParse(payload);
  if (!payloadValidation.success) {
    throw new Error(
      `Invalid backup payload: ${payloadValidation.error.issues[0]?.message || 'schema validation failed'}`,
    );
  }

  return payloadValidation.data;
};
