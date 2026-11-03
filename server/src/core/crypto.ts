// ==============================================================================
// Utilitários Criptográficos e de Sessão (Zero dependências externas)
// Opera 100% sobre node:crypto nativo do Node.js 22
// ==============================================================================

import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual
} from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
export const SESSION_COOKIE_NAME = 'hhoff_session';

/**
 * Gera hash criptográfico seguro de senha utilizando scrypt com salt aleatório.
 * Formato retornado: `scrypt$<saltHex>$<hashHex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      const saltHex = salt.toString('hex');
      const hashHex = derivedKey.toString('hex');
      resolve(`scrypt$${saltHex}$${hashHex}`);
    });
  });
}

/**
 * Verifica se a senha em texto plano confere com o hash salvo via scrypt (tempo constante).
 */
export async function verifyPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  if (!encodedHash || typeof encodedHash !== 'string') return false;

  const parts = encodedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, saltHex, expectedHashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(expectedHashHex, 'hex');

  return new Promise(resolve => {
    scrypt(password, salt, expectedHash.length, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const matches = timingSafeEqual(derivedKey, expectedHash);
        resolve(matches);
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Gera token aleatório seguro (hexadecimal).
 */
export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Gera identificador UUID v4 compatível.
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Realiza comparação em tempo constante de duas strings ou tokens.
 * Protegido contra ataques de temporização (Timing Attacks).
 */
export function safeCompareTokens(
  a: string | undefined,
  b: string | undefined
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Executa comparação fictícia para equalizar tempo de execução
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Analisa o cabeçalho 'Cookie' de uma requisição HTTP.
 */
export function parseCookieHeader(
  header: string | undefined
): Record<string, string> {
  if (!header || typeof header !== 'string') return {};

  const cookies: Record<string, string> = {};
  const pairs = header.split(';');

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;

    const key = pair.slice(0, idx).trim();
    const rawVal = pair.slice(idx + 1).trim();

    if (key) {
      try {
        cookies[key] = decodeURIComponent(rawVal);
      } catch {
        cookies[key] = rawVal;
      }
    }
  }

  return cookies;
}

export interface BuildCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

/**
 * Monta o cabeçalho Set-Cookie para a sessão stateful segura.
 * HttpOnly; SameSite=Strict; Path=/api/v1; Secure (em prod)
 */
export function buildSessionCookie(
  sessionId: string,
  opts: BuildCookieOptions
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/v1',
    `Max-Age=${Math.max(0, opts.maxAgeSeconds)}`
  ];

  if (opts.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Monta o cabeçalho Set-Cookie para limpar/invalidar o cookie de sessão no navegador.
 */
export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/v1',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
