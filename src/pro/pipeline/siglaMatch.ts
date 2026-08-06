/**
 * Match de texto do cliente → sigla comercial da empresa
 * (`siglas_comerciais.sigla` / `descricao`).
 */

import type { CompanySigla } from "./customerPackagingHabit";

function norm(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sinônimos PT comuns → sigla típica (só aplica se a empresa tiver essa sigla). */
const COMMON_ALIASES: Array<{ words: string[]; preferSigla: string }> = [
    { words: ["caixa", "caixas"], preferSigla: "CX" },
    { words: ["unidade", "unidades"], preferSigla: "UN" },
    { words: ["fardo", "fardos"], preferSigla: "FARD" },
    { words: ["pacote", "pacotes", "pack", "packs"], preferSigla: "PAC" },
    { words: ["combo", "combos"], preferSigla: "COMBO" },
];

/**
 * Detecta sigla pedida no texto, usando o cadastro da empresa (sigla + descrição)
 * e aliases PT. Null se o cliente não nomeou nenhuma sigla.
 */
export function matchExplicitSiglaFromText(
    segment: string,
    companySiglas: CompanySigla[],
    /** Se informado, só aceita siglas que existem nos hits. */
    hitSiglas?: string[] | null
): string | null {
    const t = norm(segment);
    if (!t || !companySiglas.length) return null;

    const allowed = hitSiglas?.length
        ? new Set(hitSiglas.map((s) => s.trim().toUpperCase()).filter(Boolean))
        : null;

    const usable = companySiglas.filter((sc) => {
        if (!sc.sigla) return false;
        if (!allowed) return true;
        return allowed.has(sc.sigla.toUpperCase());
    });
    if (!usable.length) return null;

    type Cand = { sigla: string; score: number };
    const cands: Cand[] = [];

    for (const sc of usable) {
        const sig = norm(sc.sigla);
        if (sig.length >= 1) {
            const re =
                sig.length <= 2
                    ? new RegExp(`(?:^|\\s)${escapeRe(sig)}(?:\\s|$|[).,])`, "u")
                    : new RegExp(`\\b${escapeRe(sig)}\\b`, "u");
            if (re.test(t)) cands.push({ sigla: sc.sigla.toUpperCase(), score: 20 + sig.length });
        }
        const desc = norm(sc.descricao ?? "");
        if (desc.length >= 3 && new RegExp(`\\b${escapeRe(desc)}\\b`, "u").test(t)) {
            cands.push({ sigla: sc.sigla.toUpperCase(), score: 16 + desc.length });
            // plural simples: caixas, unidades, fardos, pacotes
            const plural = `${desc}s`;
            if (new RegExp(`\\b${escapeRe(plural)}\\b`, "u").test(t)) {
                cands.push({ sigla: sc.sigla.toUpperCase(), score: 17 + desc.length });
            }
        }
    }

    const bySigla = new Map(usable.map((sc) => [sc.sigla.toUpperCase(), sc]));
    for (const alias of COMMON_ALIASES) {
        const target = bySigla.get(alias.preferSigla);
        if (!target) continue;
        for (const w of alias.words) {
            if (new RegExp(`\\b${escapeRe(w)}\\b`, "u").test(t)) {
                cands.push({ sigla: target.sigla.toUpperCase(), score: 14 + w.length });
            }
        }
    }

    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    return cands[0]!.sigla;
}

export function labelForSigla(sigla: string, companySiglas: CompanySigla[]): string {
    const s = sigla.trim().toUpperCase();
    const hit = companySiglas.find((c) => c.sigla.toUpperCase() === s);
    if (hit?.descricao) return hit.descricao;
    return s;
}
