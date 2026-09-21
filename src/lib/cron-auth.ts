/**
 * Caller check for the scheduled-job endpoints under `/api/public/hooks/*`.
 *
 * Those routes bypass site auth, so they authenticate the caller themselves
 * against the service role key — a value that never reaches a browser. The
 * publishable/anon key is shipped in every client bundle and is therefore not
 * a credential. Comparison is constant time so a mismatch leaks no timing.
 */
export function cronKeyMatches(presented: string, expected: string): boolean {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
