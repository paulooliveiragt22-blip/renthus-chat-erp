export type CepLookupResult = {
    cep: string;
    logradouro: string;
    bairro: string;
    localidade: string;
    uf: string;
};

export function sanitizeCep(raw: string): string {
    return raw.replace(/\D/g, "").slice(0, 8);
}

export async function lookupCep(cepRaw: string, timeoutMs = 3500): Promise<CepLookupResult | null> {
    const cep = sanitizeCep(cepRaw);
    if (cep.length !== 8) return null;
    try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!data || data.erro) return null;
        return {
            cep,
            logradouro: String(data.logradouro ?? ""),
            bairro: String(data.bairro ?? ""),
            localidade: String(data.localidade ?? ""),
            uf: String(data.uf ?? ""),
        };
    } catch {
        return null;
    }
}
