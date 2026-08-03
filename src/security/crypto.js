import {
  createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual
} from 'node:crypto';
import { AppError, ErrorCode } from '../core/errors.js';

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function hashPassword(password, salt = randomBytes(16).toString('base64url')) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new AppError(ErrorCode.INVALID_INPUT, '密码至少需要 12 个字符');
  }
  return { salt, hash: scryptSync(password, salt, 64).toString('base64url') };
}

export function verifyPassword(password, salt, expected) {
  const actual = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, 'base64url');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function encryptionKey(secret) {
  if (!secret || String(secret).length < 32) {
    throw new AppError(ErrorCode.CONFIGURATION_ERROR, 'WORKBENCH_MASTER_KEY 至少需要 32 个字符');
  }
  return createHash('sha256').update(String(secret)).digest();
}

export function encryptSecret(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(payload, secret) {
  try {
    const [iv, tag, encrypted] = String(payload).split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.CONFIGURATION_ERROR, '无法解密凭据', undefined, { cause: error });
  }
}
