import type { Context } from 'hono';

// ============ 统一返回格式 ============
export function ok(c: Context, data: unknown = null, message = '操作成功') {
  return c.json({ success: true, data, message });
}

export function fail(c: Context, code: string, message: string, status = 400) {
  const obj = { success: false as const, error: { code, message } };
  return c.json(obj, status as Parameters<typeof c.json>[1]);
}

// ============ 统一错误码 ============
export const ERR = {
  EQUIPMENT_NOT_FOUND: 'EQUIPMENT_NOT_FOUND',
  TAG_ALREADY_EXISTS: 'TAG_ALREADY_EXISTS',
  REPAIR_NOT_FOUND: 'REPAIR_NOT_FOUND',
  REPAIR_NO_EXISTS: 'REPAIR_NO_EXISTS',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_NUMBER: 'INVALID_NUMBER',
  IMPORT_VALIDATION_FAILED: 'IMPORT_VALIDATION_FAILED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  R2_UPLOAD_FAILED: 'R2_UPLOAD_FAILED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  DICT_VALUE_IN_USE: 'DICT_VALUE_IN_USE',
} as const;

// ============ 基础编解码 ============
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToStdB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function stdB64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlEncode(bytes: Uint8Array): string {
  return bytesToStdB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  let normalized = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (normalized.length % 4) normalized += '=';
  return stdB64ToBytes(normalized);
}

// ============ JWT（HS256） ============
async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

export async function signToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const h = b64urlEncode(textEncoder.encode(JSON.stringify(header)));
  const b = b64urlEncode(textEncoder.encode(JSON.stringify(body)));
  const sig = await hmacSign(`${h}.${b}`, secret);
  return `${h}.${b}.${sig}`;
}

export async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, b, sig] = parts;
    const expected = await hmacSign(`${h}.${b}`, secret);
    if (sig !== expected) return null;
    const body = JSON.parse(textDecoder.decode(b64urlDecode(b)));
    if (typeof body.exp !== 'number' || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

// ============ 密码哈希（PBKDF2-SHA256） ============
export const PASSWORD_HASH_PREFIX = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `${PASSWORD_HASH_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToStdB64(salt)}$${bytesToStdB64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const parts = hash.split('$');
    if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_PREFIX) return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isInteger(iterations) || iterations <= 0) return false;
    const salt = stdB64ToBytes(parts[2]);
    const expected = stdB64ToBytes(parts[3]);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const actual = new Uint8Array(bits);
    if (actual.byteLength !== expected.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < actual.byteLength; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

// ============ 短期签名访问（R2 文件用，不永久公开） ============
export async function signAccess(secret: string, id: string | number, exp: number): Promise<string> {
  const data = `${id}:${exp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

export async function verifyAccess(secret: string, id: string | number, exp: string, sig: string): Promise<boolean> {
  const expN = Number(exp);
  if (!Number.isInteger(expN) || expN < Math.floor(Date.now() / 1000)) return false;
  const expected = await signAccess(secret, id, expN);
  return sig === expected;
}

// ============ 常见字符串工具 ============
const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export function nowString(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function isValidDateString(s: string): boolean {
  if (!s || s.trim() === '') return true; // 日期允许为空
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as unknown as [string, number, number, number];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

// ============ 维修单号生成 RF-YYYYMMDD-XXX ============
export async function nextRepairNo(db: D1Database): Promise<string> {
  const today = nowString().slice(0, 10).replace(/-/g, '');
  const prefix = `RF-${today}-`;
  const rows = (await db
    .prepare(`SELECT repair_no FROM repair WHERE repair_no LIKE ? ORDER BY repair_no DESC LIMIT 1`)
    .bind(`${prefix}%`)
    .all<{ repair_no: string }>()) as D1Result<{ repair_no: string }>;
  let seq = 1;
  if (rows.results.length > 0) {
    const last = rows.results[0].repair_no;
    const n = parseInt(last.slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${pad(seq, 3)}`;
}