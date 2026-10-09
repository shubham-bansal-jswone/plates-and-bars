// expo-crypto's native/web digest is not available under Jest; node's SHA-1 stands in for it. Use as
// jest.mock('expo-crypto', () => require('./sync-crypto-mock')).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require('node:crypto') as { createHash(a: string): { update(d: unknown): { digest(): Uint8Array } } };

export const CryptoDigestAlgorithm = { SHA1: 'SHA-1' };
export const digest = async (_a: string, data: Uint8Array) => {
  const b = nodeCrypto.createHash('sha1').update(data).digest();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};
export const randomUUID = () => globalThis.crypto.randomUUID();
