/**
 * Nomes genéricos de cliente (fallback UI / webhook antes do perfil Meta).
 */

const GENERIC_CUSTOMER_NAMES = new Set([
    "cliente",
    "cliente instagram",
    "cliente messenger",
    "cliente whatsapp",
]);

export function normalizeCustomerDisplayName(name: string | null | undefined): string {
    return (name ?? "").trim();
}

export function isGenericCustomerDisplayName(name: string | null | undefined): boolean {
    const normalized = normalizeCustomerDisplayName(name).toLowerCase();
    return normalized === "" || GENERIC_CUSTOMER_NAMES.has(normalized);
}

export function fallbackMetaThreadProfileName(
    channel: "instagram" | "messenger"
): string {
    return channel === "instagram" ? "Cliente Instagram" : "Cliente Messenger";
}

/** Evita sobrescrever nome real com placeholder genérico. */
export function shouldUpdateThreadProfileName(
    existing: string | null | undefined,
    incoming: string | null | undefined
): boolean {
    const next = normalizeCustomerDisplayName(incoming);
    if (!next || isGenericCustomerDisplayName(next)) return false;

    const prev = normalizeCustomerDisplayName(existing);
    if (!prev) return true;
    if (isGenericCustomerDisplayName(prev)) return true;
    return next !== prev;
}
