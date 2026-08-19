/** Linha curta para o header do cardápio: rua, bairro, cidade. */

export function formatMenuCustomerAddressLine(a: {
    logradouro: string;
    numero?: string | null;
    bairro?: string | null;
    cidade?: string | null;
}): string {
    const street = [a.logradouro.trim(), (a.numero ?? "").trim()].filter(Boolean).join(", ");
    return [street, (a.bairro ?? "").trim(), (a.cidade ?? "").trim()].filter(Boolean).join(" · ");
}
