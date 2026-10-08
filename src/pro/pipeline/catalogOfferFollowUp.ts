/**
 * Depois de "tem caixinha de skol?" o servidor guarda 1 pick.
 * "Quero a caixa" reusa esse pick — não busca a palavra "caixa" no catálogo inteiro.
 */

import { extractExplicitOrderQuantityFromText } from "@/src/pro/tools/parseQtyPt";

export type CatalogOfferPick = {
    embalagemId: string;
    label: string;
    price?: number | null;
    productName?: string | null;
    serveAte?: number | null;
};

const FILLER = new Set([
    "quero",
    "queria",
    "manda",
    "mande",
    "pode",
    "ser",
    "essa",
    "esse",
    "isso",
    "me",
    "a",
    "o",
    "de",
    "da",
    "do",
    "um",
    "uma",
    "por",
    "favor",
    "pfv",
    "sim",
    "entao",
    "então",
]);

const PACK_TO_SIGLA: Record<string, string> = {
    caixa: "CX",
    caixas: "CX",
    cx: "CX",
    unidade: "UN",
    unidades: "UN",
    un: "UN",
    fardo: "FARD",
    fardos: "FARD",
    pacote: "PAC",
    pacotes: "PAC",
    lata: "LATA",
    latas: "LATA",
};

function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function looksLikeAvailabilityQuestion(text: string): boolean {
    const n = normalize(text);
    if (!n) return false;
    return /^(?:vc|voce|voces)\s+(?:tem|vende)\b/u.test(n) || /^(?:tem|vende)\b/u.test(n);
}

/** Sigla comercial no rótulo canónico: "SKOL LATA (CX c/15)". */
export function siglaFromOfferLabel(label: string): string | null {
    const m = label.toUpperCase().match(/\((CX|UN|FARD|PAC|FD)\b/u);
    if (!m) return null;
    return m[1] === "FD" ? "FARD" : m[1]!;
}

function offerMatchesPack(label: string, packToken: string): boolean {
    const sigla = siglaFromOfferLabel(label);
    const want = PACK_TO_SIGLA[packToken];
    if (!want) return false;
    if (sigla) {
        if (want === "LATA") return sigla === "UN" && normalize(label).includes("lata");
        return sigla === want;
    }
    const flat = normalize(label);
    if (want === "CX") return /\b(caixa|cx)\b/u.test(flat);
    if (want === "UN") return /\b(unidade|un)\b/u.test(flat);
    if (want === "FARD") return /\bfardo\b/u.test(flat);
    if (want === "LATA") return sigla == null && /\blata\b/u.test(flat);
    return /\bpacote\b/u.test(flat);
}

/**
 * `null` quando a frase é produto novo, pergunta de estoque, ou não aceita a oferta.
 * Quantidade: número explícito; senão 1 no singular ("a caixa"). Plural sem número não fecha.
 */
export function resolveCatalogOfferFollowUp(
    userText: string,
    picks: readonly CatalogOfferPick[] | null | undefined
): { embalagemId: string; quantity: number } | null {
    if (!picks || picks.length !== 1) return null;
    const pick = picks[0];
    const embId = pick?.embalagemId?.trim();
    if (!embId) return null;

    const raw = String(userText ?? "").trim();
    if (!raw || raw.length > 80) return null;
    if (looksLikeAvailabilityQuestion(raw)) return null;
    if (/^\d{1,2}$/u.test(raw)) return null;

    const n = normalize(raw);
    if (!n) return null;
    if (/\b(caixas|unidades|fardos|pacotes)\b/u.test(n) && extractExplicitOrderQuantityFromText(raw) == null) {
        return null;
    }

    const labelBlob = normalize(`${pick.label ?? ""} ${pick.productName ?? ""}`);
    const labelTokens = new Set(labelBlob.split(" ").filter((t) => t.length >= 3));
    const tokens = n.split(" ").filter(Boolean);
    const packToken = tokens.find((t) => PACK_TO_SIGLA[t] != null) ?? null;
    const content = tokens.filter(
        (t) => !FILLER.has(t) && PACK_TO_SIGLA[t] == null && !/^\d+$/u.test(t)
    );
    const foreign = content.filter((t) => t.length >= 3 && !labelTokens.has(t));
    if (foreign.length > 0) return null;

    const explicitAccept =
        /^(?:quero|manda|mande|pode ser|pode mandar|quero essa|quero esse|pode)\b/u.test(n);
    if (packToken) {
        if (!offerMatchesPack(`${pick.label ?? ""} ${pick.productName ?? ""}`, packToken)) return null;
    } else if (!explicitAccept) {
        return null;
    } else if (content.length === 0 && !/^(?:quero|manda|pode ser|pode mandar)\b/u.test(n)) {
        return null;
    }

    const qty = extractExplicitOrderQuantityFromText(raw);
    return { embalagemId: embId, quantity: qty != null && qty >= 1 ? qty : 1 };
}
