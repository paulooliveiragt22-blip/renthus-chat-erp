const OPT_OUT = new Set(["parar", "sair", "stop", "cancelar"]);
const OPT_IN = new Set(["quero ofertas", "quero promocoes", "quero promocao", "quero promo"]);

export function normalizeConsentKeyword(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

export function detectConsentIntent(text: string): "opt_out" | "opt_in" | null {
    const n = normalizeConsentKeyword(text);
    if (!n) return null;
    if (OPT_OUT.has(n)) return "opt_out";
    if (OPT_IN.has(n)) return "opt_in";
    return null;
}
