import type { MenuSlug } from "@/src/types/contracts.public-menu";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LEN = 64;
const MIN_LEN = 2;

/** Normaliza texto livre → slug candidato (sem validar unicidade). */
export function normalizeMenuSlug(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_LEN)
        .replace(/-+$/g, "");
}

export type MenuSlugValidation =
    | { ok: true; slug: MenuSlug }
    | { ok: false; error: "slug_empty" | "slug_too_short" | "slug_too_long" | "slug_invalid" };

export function parseMenuSlug(raw: unknown): MenuSlugValidation {
    if (typeof raw !== "string") return { ok: false, error: "slug_empty" };
    const slug = normalizeMenuSlug(raw);
    if (!slug) return { ok: false, error: "slug_empty" };
    if (slug.length < MIN_LEN) return { ok: false, error: "slug_too_short" };
    if (slug.length > MAX_LEN) return { ok: false, error: "slug_too_long" };
    if (!SLUG_RE.test(slug)) return { ok: false, error: "slug_invalid" };
    return { ok: true, slug: slug as MenuSlug };
}

export function slugFromDisplayName(displayName: string): string {
    const base = normalizeMenuSlug(displayName);
    return base.length >= MIN_LEN ? base : `loja-${Date.now().toString(36)}`;
}
