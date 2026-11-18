/**
 * The menu item a path belongs to: the longest matching href or extra match
 * prefix, so /workforce/teams selects "Tiimit" and not "Henkilöt".
 */
export function activeNavKey<K extends string>(groups: { items: { key: K; href: string; match?: string[] }[] }[], pathname: string): K | null {
  let best: { key: K; len: number } | null = null;
  for (const g of groups) {
    for (const i of g.items) {
      for (const href of [i.href, ...(i.match ?? [])]) {
        if ((pathname === href || pathname.startsWith(`${href}/`)) && (!best || href.length > best.len)) best = { key: i.key, len: href.length };
      }
    }
  }
  return best?.key ?? null;
}
