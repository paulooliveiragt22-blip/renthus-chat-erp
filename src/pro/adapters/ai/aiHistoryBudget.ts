/**
 * Orçamento de histórico enviado ao LLM (anti-estouro de context window / custo).
 * Janela + truncagem; resumo rolling via SessionMemoryPort (`aiHistorySummary`).
 */

import type { AiTurn } from "@/src/types/contracts";

export const AI_HISTORY_MAX_TURNS_HARD = 24;
export const AI_HISTORY_MAX_CHARS_PER_TURN = 4_000;
export const AI_HISTORY_MAX_TOTAL_CHARS = 48_000;

function truncateContent(content: unknown, maxChars: number): unknown {
    if (typeof content === "string") {
        if (content.length <= maxChars) return content;
        return `${content.slice(0, maxChars)}…[truncado]`;
    }
    if (Array.isArray(content)) {
        /** Blocos tool_use/tool_result: serializa e corta se enorme. */
        try {
            const json = JSON.stringify(content);
            if (json.length <= maxChars) return content;
            return `${json.slice(0, maxChars)}…[tool_blocks_truncados]`;
        } catch {
            return "[conteúdo inválido]";
        }
    }
    if (content && typeof content === "object") {
        try {
            const json = JSON.stringify(content);
            if (json.length <= maxChars) return content;
            return `${json.slice(0, maxChars)}…[truncado]`;
        } catch {
            return "[conteúdo inválido]";
        }
    }
    return content;
}

/**
 * Seleciona as últimas N turns e aplica teto de caracteres (por turn e total).
 */
export function budgetAiHistoryForLlm(
    history: AiTurn[],
    opts?: {
        maxTurns?: number;
        maxCharsPerTurn?: number;
        maxTotalChars?: number;
    }
): AiTurn[] {
    const maxTurns = Math.min(
        AI_HISTORY_MAX_TURNS_HARD,
        Math.max(1, opts?.maxTurns ?? AI_HISTORY_MAX_TURNS_HARD)
    );
    const maxPer = opts?.maxCharsPerTurn ?? AI_HISTORY_MAX_CHARS_PER_TURN;
    const maxTotal = opts?.maxTotalChars ?? AI_HISTORY_MAX_TOTAL_CHARS;

    const window = history.slice(-maxTurns).map((h) => ({
        ...h,
        content: truncateContent(h.content, maxPer),
    }));

    let total = 0;
    const kept: AiTurn[] = [];
    for (let i = window.length - 1; i >= 0; i--) {
        const turn = window[i]!;
        const size =
            typeof turn.content === "string"
                ? turn.content.length
                : (() => {
                      try {
                          return JSON.stringify(turn.content).length;
                      } catch {
                          return maxPer;
                      }
                  })();
        if (kept.length > 0 && total + size > maxTotal) break;
        kept.push(turn);
        total += size;
    }
    return kept.reverse();
}
