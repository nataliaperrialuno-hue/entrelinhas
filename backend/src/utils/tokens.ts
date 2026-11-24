import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits de aleatoriedade, codificados de forma segura para URL. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** HMAC-SHA256 em hexadecimal; é isso que deve ser persistido. */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Compara dois hashes hexadecimais de 32 bytes em tempo constante.
 * Hashes malformados ou de tamanho diferente são rejeitados sem comparação.
 */
export function tokensEqual(leftHash: string, rightHash: string): boolean {
  const left = Buffer.from(leftHash, 'hex');
  const right = Buffer.from(rightHash, 'hex');

  if (left.length !== 32 || right.length !== 32) {
    return false;
  }

  return timingSafeEqual(left, right);
}
