/** Linha curta para o header do cardápio: rua, bairro, cidade. */

function isPlaceholderPart(value: string | null | undefined): boolean {
    const t = String(value ?? "").trim().toLowerCase();
    if (!t) return true;
    if (t === "-" || t === "—" || t === "--") return true;
    if (t === "s/n" || t === "sn") return true;
    if (t === "(completar)" || t === "completar") return true;
    return false;
}

export function formatMenuCustomerAddressLine(a: {
    logradouro: string;
    numero?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    description?: string;
}): string {
    const street = [a.logradouro.trim(), (a.numero ?? "").trim()]
        .filter((part) => !isPlaceholderPart(part))
        .join(", ");
    const parts = [street, (a.bairro ?? "").trim(), (a.cidade ?? "").trim()].filter(
        (part) => !isPlaceholderPart(part)
    );
    if (parts.length > 0) return parts.join(" · ");
    const fallback = (a.description ?? "").trim();
    return fallback || "Endereço incompleto";
}
