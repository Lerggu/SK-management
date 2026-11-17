/**
 * Finnish personal identity code (henkilötunnus): DDMMYYCZZZQ, where C is the
 * century sign (+ 1800s; - Y X W V U 1900s; A B C D E F 2000s), ZZZ the
 * individual number (002–899; 900–999 temporary codes are also accepted) and
 * Q the check character. Returns the normalized code or null.
 */
const CHECK = "0123456789ABCDEFHJKLMNPRSTUVWXY";
const CENTURY: Record<string, number> = { "+": 1800, "-": 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900, A: 2000, B: 2000, C: 2000, D: 2000, E: 2000, F: 2000 };

export function normalizePersonalId(input: string): string | null {
  const s = input.trim().toUpperCase();
  const m = /^(\d{2})(\d{2})(\d{2})([-+A-FU-Y])(\d{3})([0-9A-Y])$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yy, sign, num, check] = m;
  const year = CENTURY[sign] + Number(yy);
  const date = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) return null;
  if (Number(num) < 2) return null;
  if (CHECK[Number(`${dd}${mm}${yy}${num}`) % 31] !== check) return null;
  return s;
}

/** "131052-308T" → "••••••-•••T" for confirmations; never shows the birth date. */
export function maskPersonalId(code: string): string {
  return `${"•".repeat(6)}${code[6]}${"•".repeat(3)}${code[10]}`;
}
