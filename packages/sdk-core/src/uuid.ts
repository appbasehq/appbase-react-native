/**
 * RFC 9562 UUIDv7: 48 bits of Unix milliseconds, then 74 random bits. Time-ordered event IDs keep
 * the server's per-app event index compact. Uses crypto.getRandomValues when the host has it;
 * Hermes does not by default, and Math.random is enough here: IDs need uniqueness, not secrecy.
 */
export function uuidv7(milliseconds = Date.now()): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => unknown } })
    .crypto;
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  let time = Math.max(0, Math.floor(milliseconds));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
