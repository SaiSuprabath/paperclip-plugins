export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(d);
}
export function fmtDateFull(iso: string | null | undefined): string {
  return fmtDate(iso, { day: "numeric", month: "short", year: "numeric" });
}
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
export function statusLabel(s: string): string {
  return s.replace(/_/g, " ");
}
