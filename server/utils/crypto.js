import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

// Generate a deterministic encryption key based on user ID and a server secret
// SERVER_SECRET must come from the environment - never ship a default
const SERVER_SECRET = process.env.ENCRYPTION_SECRET;

if (!SERVER_SECRET || SERVER_SECRET.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be set in the environment and be at least 32 characters long');
}

// Secret that used to be hard-coded as the default. Kept for READ-ONLY migration of
// data that was encrypted before ENCRYPTION_SECRET became mandatory. Never used to encrypt.
const LEGACY_SECRET = 'clockwize-secret-key-change-in-production';

// pbkdf2 with 100k iterations is expensive - cache derived keys per (secret, salt)
const keyCache = new Map();

function deriveKey(secret, salt) {
    const cacheKey = `${secret === SERVER_SECRET ? 'current' : 'legacy'}:${salt}`;
    let key = keyCache.get(cacheKey);
    if (!key) {
        key = crypto.pbkdf2Sync(secret, String(salt), 100000, 32, 'sha256');
        keyCache.set(cacheKey, key);
    }
    return key;
}

/**
 * Derives an encryption key for a specific user
 * @param {string} userId - The user's unique ID
 * @returns {Buffer} - 32-byte encryption key
 */
export function deriveKeyForUser(userId) {
    return deriveKey(SERVER_SECRET, userId);
}

/**
 * Encrypts a text string using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @param {string} userId - User ID to derive the encryption key
 * @returns {string} - Encrypted string in format: iv:encrypted:tag (all hex encoded)
 */
export function encrypt(text, userId) {
    if (!text) return null;

    const key = deriveKeyForUser(userId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Return format: iv:encrypted:tag
    return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
}

function decryptWithSecret(encryptedText, salt, secret) {
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) return null;

        const [ivHex, encrypted, tagHex] = parts;
        const key = deriveKey(secret, salt);
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');

        // Pin the tag length - otherwise GCM accepts a truncated (forgeable) 4-byte tag
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        return null;
    }
}

/**
 * Decrypts an encrypted string, trying the current secret first and falling back
 * to the legacy (previously hard-coded) secret for data that was never migrated.
 * @param {string} encryptedText - Encrypted string in format: iv:encrypted:tag
 * @param {string} salt - The id (workspace/user) the value was encrypted with
 * @returns {{ value: string, legacy: boolean }|null} - null when nothing could decrypt it
 */
export function decryptDetailed(encryptedText, salt) {
    if (!encryptedText) return null;

    const current = decryptWithSecret(encryptedText, salt, SERVER_SECRET);
    if (current !== null) return { value: current, legacy: false };

    const legacy = decryptWithSecret(encryptedText, salt, LEGACY_SECRET);
    if (legacy !== null) return { value: legacy, legacy: true };

    return null;
}

/**
 * Decrypts an encrypted string
 * @param {string} encryptedText - Encrypted string in format: iv:encrypted:tag
 * @param {string} userId - User ID to derive the encryption key
 * @returns {string} - Decrypted plain text
 */
export function decrypt(encryptedText, userId) {
    if (!encryptedText) return null;

    const result = decryptDetailed(encryptedText, userId);
    return result ? result.value : null;
}

/**
 * One-time migration: re-encrypts values that are still encrypted with the legacy
 * secret (or with the pre-workspace user id salt) using the current ENCRYPTION_SECRET.
 * Safe to run on every boot - it only touches rows it could actually decrypt.
 * @param {object} db - the Database wrapper from database.js
 */
export function migrateLegacyEncryption(db) {
    let migrated = 0;

    // --- credentials: encrypted with workspace_id today, user_id before workspaces ---
    try {
        const rows = db.prepare(`
            SELECT id, user_id, workspace_id, username, password, notes
            FROM credentials
        `).all();

        for (const row of rows) {
            const target = row.workspace_id || row.user_id;
            if (!target) continue;

            const saltCandidates = [row.workspace_id, row.user_id].filter(Boolean);
            const updates = {};

            for (const field of ['username', 'password', 'notes']) {
                const stored = row[field];
                if (!stored) continue;

                for (const salt of saltCandidates) {
                    const result = decryptDetailed(stored, salt);
                    if (!result) continue;
                    // already stored with the current secret and the current salt
                    if (!result.legacy && salt === target) break;
                    updates[field] = encrypt(result.value, target);
                    break;
                }
            }

            if (Object.keys(updates).length > 0) {
                db.prepare(`
                    UPDATE credentials
                    SET username = ?, password = ?, notes = ?
                    WHERE id = ?
                `).run(
                    updates.username !== undefined ? updates.username : row.username,
                    updates.password !== undefined ? updates.password : row.password,
                    updates.notes !== undefined ? updates.notes : row.notes,
                    row.id
                );
                migrated++;
            }
        }
    } catch (error) {
        console.error('Legacy credential re-encryption failed:', error.message);
    }

    // --- addon_settings: encrypted with workspace_id today, user_id before workspaces ---
    try {
        const rows = db.prepare(`
            SELECT id, workspace_id, setting_value FROM addon_settings
        `).all();

        for (const row of rows) {
            if (!row.setting_value || !row.workspace_id) continue;
            // only encrypted values use the iv:data:tag shape
            if (row.setting_value.split(':').length !== 3) continue;

            const memberIds = db.prepare(`
                SELECT user_id FROM workspace_members WHERE workspace_id = ?
            `).all(row.workspace_id).map(m => m.user_id);

            for (const salt of [row.workspace_id, ...memberIds]) {
                const result = decryptDetailed(row.setting_value, salt);
                if (!result) continue;
                if (!result.legacy && salt === row.workspace_id) break;

                db.prepare(`
                    UPDATE addon_settings
                    SET setting_value = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(encrypt(result.value, row.workspace_id), row.id);
                migrated++;
                break;
            }
        }
    } catch (error) {
        console.error('Legacy addon setting re-encryption failed:', error.message);
    }

    if (migrated > 0) {
        console.log(`🔐 Re-encrypted ${migrated} legacy record(s) with the current ENCRYPTION_SECRET`);
    }

    return migrated;
}
