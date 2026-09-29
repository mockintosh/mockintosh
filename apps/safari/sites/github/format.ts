/** Compact counts the way the repository header shows them. */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) {
    const tenths = Math.round(count / 100) / 10;
    return `${tenths}k`.replace(/\.0k$/, "k");
  }
  return `${Math.round(count / 1000)}k`;
}

/** File size as shown beside a blob. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${trimTenths(bytes / 1024)} KB`;
  return `${trimTenths(bytes / (1024 * 1024))} MB`;
}

/** Short age for a commit or issue, relative to `now` (ms). */
export function formatAge(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** First line of a commit message, capped so the commit bar stays one line. */
export function commitSubject(message: string): string {
  const line = message.split("\n")[0] ?? "";
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

function trimTenths(value: number): string {
  const tenths = Math.round(value * 10) / 10;
  return String(tenths);
}
