export type OptionalAddressInput = {
    apelido?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
};

export type CustomerAddressPayload = {
    apelido: string;
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string | null;
    is_principal: true;
};

function text(value: string | null | undefined): string {
    return String(value ?? "").trim();
}

export function optionalCustomerAddress(
    input: OptionalAddressInput | null | undefined
): { ok: true; address: CustomerAddressPayload | null } | { ok: false; error: "address_incomplete" } {
    if (!input) return { ok: true, address: null };
    const logradouro = text(input.logradouro);
    const numero = text(input.numero);
    const bairro = text(input.bairro);
    const cidade = text(input.cidade);
    const estado = text(input.estado).toUpperCase();
    const filled = [logradouro, numero, bairro, cidade, estado].filter((part) => part.length > 0);
    if (filled.length === 0) return { ok: true, address: null };
    if (logradouro.length === 0 || numero.length === 0 || bairro.length === 0 || cidade.length === 0 || estado.length !== 2) {
        return { ok: false, error: "address_incomplete" };
    }
    const complemento = text(input.complemento);
    const cep = text(input.cep);
    return {
        ok: true,
        address: {
            apelido: text(input.apelido) || "Casa",
            logradouro,
            numero,
            complemento: complemento || null,
            bairro,
            cidade,
            estado,
            cep: cep || null,
            is_principal: true,
        },
    };
}
