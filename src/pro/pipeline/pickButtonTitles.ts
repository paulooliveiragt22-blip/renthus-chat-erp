/**
 * Títulos de botões de clarificação (WhatsApp reply_button).
 * Meta exige títulos únicos e ≤ 20 chars — truncar rótulos longos iguais
 * (ex.: "ORIGINAL TREZENTINHA" vs "... (CX c/23)") gera rejeição da API.
 */

import { PICK_EMB_PREFIX } from "./productPickText";

export const WA_BUTTON_TITLE_MAX = 20;

export function normalizeButtonLabel(raw: string): string {
    return String(raw ?? "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/**
 * Prefixo `N) ` + rótulo truncado para caber em `max` chars.
 * O dígito garante unicidade entre opções do mesmo card.
 */
export function numberedPickTitle(
    index1Based: number,
    label: string,
    max: number = WA_BUTTON_TITLE_MAX
): string {
    const n = Math.max(1, Math.floor(index1Based));
    const prefix = `${n}) `;
    const budget = Math.max(1, max - prefix.length);
    const body = normalizeButtonLabel(label || `Opcao ${n}`).slice(0, budget);
    return `${prefix}${body}`.slice(0, max);
}

/**
 * Garante títulos únicos no conjunto (fallback se dois prefixos colidirem).
 */
export function ensureUniqueButtonTitles(
    titles: string[],
    max: number = WA_BUTTON_TITLE_MAX
): string[] {
    const seen = new Map<string, number>();
    return titles.map((raw, i) => {
        let title = normalizeButtonLabel(raw).slice(0, max) || numberedPickTitle(i + 1, `Opcao ${i + 1}`, max);
        const key = title.toLowerCase();
        const count = seen.get(key) ?? 0;
        seen.set(key, count + 1);
        if (count === 0) return title;
        // Colisão residual: força prefixo numérico.
        return numberedPickTitle(i + 1, title.replace(/^\d+\)\s*/u, ""), max);
    });
}

export function buildUniquePickButtons(
    picks: Array<{ embalagemId: string; label: string }>,
    opts?: { idPrefix?: string; max?: number }
): Array<{ id: string; title: string }> {
    const idPrefix = opts?.idPrefix ?? PICK_EMB_PREFIX;
    const max = opts?.max ?? WA_BUTTON_TITLE_MAX;
    const top = picks.slice(0, 3);
    const titles = ensureUniqueButtonTitles(
        top.map((p, i) => numberedPickTitle(i + 1, p.label ?? `Opcao ${i + 1}`, max)),
        max
    );
    return top.map((p, i) => ({
        id: `${idPrefix}${p.embalagemId}`,
        title: titles[i]!,
    }));
}

/** Texto numerado quando o envio de botões interativos falha na Meta. */
export function formatButtonsFallbackText(
    body: string,
    buttons: Array<{ id: string; title: string }>
): string {
    const trimmed = String(body ?? "").trim();
    if (trimmed && /\n\s*1\)\s+/u.test(trimmed)) {
        return trimmed.replace(
            /Toque no botao ou responda com o numero \(ex\.: 2\)\./giu,
            "Responda com o numero da opcao (ex.: 2)."
        );
    }
    const headline = trimmed || "Qual opcao voce quer?";
    const lines = buttons.map((b, i) => {
        const t =
            normalizeButtonLabel(String(b.title ?? "").replace(/^\d+\)\s*/u, "")) ||
            `Opcao ${i + 1}`;
        return `${i + 1}) ${t}`;
    });
    return [headline, "", ...lines, "", "Responda com o numero da opcao (ex.: 2)."].join("\n");
}
