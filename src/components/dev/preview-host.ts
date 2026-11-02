/** Keep account-switching tools off published hosts, including custom domains. */
export function isDevToolsHost(host: string): boolean {
  return (
    /^id-preview(?:-\d+)?--.+\.lovable\.app$/.test(host) ||
    host.endsWith(".lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}