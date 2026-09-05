"use client";

/**
 * Recentes do Cmd+K — só hrefs (navegação), localStorage por browser.
 * Sem mutação de billing.
 */

const STORAGE_KEY = "renthus.command.recent.v1";
const MAX_RECENT = 6;

export type CommandRecentEntry = {
  id: string;
  label: string;
  href: string;
  at: number;
};

export function loadCommandRecents(): CommandRecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is CommandRecentEntry =>
          !!x &&
          typeof x === "object" &&
          typeof (x as CommandRecentEntry).id === "string" &&
          typeof (x as CommandRecentEntry).href === "string" &&
          typeof (x as CommandRecentEntry).label === "string"
      )
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushCommandRecent(entry: Omit<CommandRecentEntry, "at">): CommandRecentEntry[] {
  const next: CommandRecentEntry[] = [
    { ...entry, at: Date.now() },
    ...loadCommandRecents().filter((r) => r.id !== entry.id && r.href !== entry.href),
  ].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
