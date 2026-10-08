export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function timeAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function clockTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Confirmation ids for the fictional portal. */
export function confirmationId(company: string, jobTitle: string) {
  const seed = `${company}${jobTitle}${Date.now()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `${company.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${h.toString(36).toUpperCase().slice(0, 6)}`;
}

/** Scroll a container to the bottom, tolerating environments without scrollTo. */
export function scrollToBottom(el: HTMLElement | null) {
  if (!el) return;
  try {
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  } catch {
    el.scrollTop = el.scrollHeight;
  }
}
