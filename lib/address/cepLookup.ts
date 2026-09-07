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

async function fetchJson(
    url: string,
    timeoutMs: number
): Promise<Record<string, unknown> | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            cache: "no-store",
            signal: ac.signal,
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        return data && typeof data === "object" ? data : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function lookupViaCep(cep: string, timeoutMs: number): Promise<CepLookupResult | null> {
    const data = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`, timeoutMs);
    if (!data || data.erro) return null;
    return {
        cep,
        logradouro: String(data.logradouro ?? ""),
        bairro: String(data.bairro ?? ""),
        localidade: String(data.localidade ?? ""),
        uf: String(data.uf ?? ""),
    };
}

/** Fallback quando ViaCEP falha/timeout (comum no browser). */
async function lookupBrasilApi(cep: string, timeoutMs: number): Promise<CepLookupResult | null> {
    const data = await fetchJson(`https://brasilapi.com.br/api/cep/v1/${cep}`, timeoutMs);
    if (!data || data.message) return null;
    const uf = String(data.state ?? "").trim();
    if (!uf) return null;
    return {
        cep,
        logradouro: String(data.street ?? ""),
        bairro: String(data.neighborhood ?? ""),
        localidade: String(data.city ?? ""),
        uf,
    };
}

export async function lookupCep(cepRaw: string, timeoutMs = 3500): Promise<CepLookupResult | null> {
    const cep = sanitizeCep(cepRaw);
    if (cep.length !== 8) return null;
    const via = await lookupViaCep(cep, timeoutMs);
    if (via && (via.logradouro || via.localidade)) return via;
    return lookupBrasilApi(cep, timeoutMs);
}
