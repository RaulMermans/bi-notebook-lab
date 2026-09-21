/** Deterministic, dependency-free 32-bit string hash (FNV-1a) — good enough for change-detection, not cryptographic use. Shared by validation and query fingerprinting. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
