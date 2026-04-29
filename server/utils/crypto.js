import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

// Generate a deterministic encryption key based on user ID and a server secret
// In production, SERVER_SECRET should come from environment variables
const SERVER_SECRET = process.env.ENCRYPTION_SECRET || 'clockwize-secret-key-change-in-production';

/**
 * Derives an encryption key for a specific user
 * @param {string} userId - The user's unique ID
 * @returns {Buffer} - 32-byte encryption key
 */
export function deriveKeyForUser(userId) {
    return crypto.pbkdf2Sync(
        SERVER_SECRET,
        userId,
        100000,
        32,
        'sha256'
    );
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

/**
 * Decrypts an encrypted string
 * @param {string} encryptedText - Encrypted string in format: iv:encrypted:tag
 * @param {string} userId - User ID to derive the encryption key
 * @returns {string} - Decrypted plain text
 */
export function decrypt(encryptedText, userId) {
    if (!encryptedText) return null;

    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) return null;

        const [ivHex, encrypted, tagHex] = parts;
        const key = deriveKeyForUser(userId);
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error.message);
        return null;
    }
}
