import { generateText, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiTurn } from "@/src/types/contracts";
import type {
    CompactHistoryInput,
    CompactHistoryResult,
    SessionMemoryPort,
} from "@/src/pro/ports/sessionMemory.port";
import {
    getConfiguredLlmProviderName,
    resolveLanguageModel,
    type LlmProviderName,
} from "@/src/pro/adapters/ai/modelProvider";

export const SESSION_MEMORY_KEEP_RECENT = 8;
export const SESSION_MEMORY_TRIGGER_MIN = 16;
export const SESSION_MEMORY_SUMMARY_MAX_CHARS = 1_500;

function turnSnippet(turn: AiTurn, max = 180): string {
    const role = turn.role === "user" ? "Cliente" : "Assistente";
    let text = "";
    if (typeof turn.content === "string") {
        text = turn.content;
    } else {
        try {
            text = JSON.stringify(turn.content);
        } catch {
            text = "[bloco]";
        }
    }
    const flat = text.replace(/\s+/g, " ").trim();
    return `${role}: ${flat.slice(0, max)}${flat.length > max ? "…" : ""}`;
}

/** Resumo extrativo (sem LLM) — fallback e testes. */
export function extractiveHistorySummary(
    older: AiTurn[],
    existingSummary: string | null | undefined
): string {
    const lines = older.map((t) => turnSnippet(t));
    const merged = [existingSummary?.trim(), ...lines].filter(Boolean).join("\n");
    if (merged.length <= SESSION_MEMORY_SUMMARY_MAX_CHARS) return merged;
    return `${merged.slice(0, SESSION_MEMORY_SUMMARY_MAX_CHARS)}…`;
}

/**
 * Compacta histórico longo via LLM (rolling summary) com fallback extrativo.
 *
 * `modelOverride` é um seam de teste (injeta `MockLanguageModelV3` de `ai/test`
 * em vez de depender de `resolveLanguageModel()`/rede); em produção fica vazio
 * e cada chamada resolve o modelo configurado por env.
 */
export class LlmSessionMemoryAdapter implements SessionMemoryPort {
    constructor(
        private readonly admin?: SupabaseClient | null,
        private readonly companyId?: string,
        /** Seam de teste — injeta `MockLanguageModelV3` em vez de `resolveLanguageModel()`/rede. */
        private readonly modelOverride?: LanguageModel,
        /**
         * Provider/modelo resolvidos por empresa. Resolvidos **preguiçosamente** dentro de
         * `compactIfNeeded` (já protegido por try/catch com fallback extrativo) — nunca aqui no
         * construtor, pra não arriscar `LlmProviderConfigError` síncrono em toda mensagem de
         * WhatsApp (a maioria nem aciona compactação).
         */
        private readonly providerOverride?: LlmProviderName,
        private readonly modelNameOverride?: string
    ) {}

    async compactIfNeeded(input: CompactHistoryInput): Promise<CompactHistoryResult> {
        const keep = Math.max(2, input.keepRecentTurns ?? SESSION_MEMORY_KEEP_RECENT);
        const trigger = Math.max(keep + 2, input.triggerMinTurns ?? SESSION_MEMORY_TRIGGER_MIN);
        const history = input.history ?? [];

        if (history.length <= trigger) {
            return {
                history,
                summary: input.existingSummary?.trim() || null,
                compacted: false,
            };
        }

        const older = history.slice(0, -keep);
        const recent = history.slice(-keep);
        const existing = input.existingSummary?.trim() || null;

        let summary = extractiveHistorySummary(older, existing);
        try {
            const result = await generateText({
                model:
                    this.modelOverride ??
                    resolveLanguageModel({ provider: this.providerOverride, model: this.modelNameOverride }),
                system:
                    "Você resume histórico de chat de pedidos WhatsApp para contexto interno. " +
                    "Em português do Brasil, 5–10 linhas: itens/pedidos mencionados, endereço, pagamento, pendências. " +
                    "Sem inventar fatos. Sem UUIDs. Sem preços inventados.",
                prompt:
                    (existing ? `Resumo anterior:\n${existing}\n\n` : "") +
                    `Trechos a condensar:\n${older.map((t) => turnSnippet(t, 240)).join("\n")}`,
                maxOutputTokens: 400,
                maxRetries: 2,
                abortSignal: AbortSignal.timeout(12_000),
            });

            if (this.admin && this.companyId) {
                try {
                    const { debitFromAnthropicUsage } = await import("@/lib/billing/aiWallet");
                    await debitFromAnthropicUsage(
                        this.admin,
                        this.companyId,
                        {
                            input_tokens: result.usage.inputTokens ?? 0,
                            output_tokens: result.usage.outputTokens ?? 0,
                        },
                        {
                            source: "pro_session_memory_summarize",
                            provider: this.providerOverride ?? getConfiguredLlmProviderName(),
                            model: result.response.modelId?.trim() || "unknown",
                        }
                    );
                } catch {
                    /* billing best-effort */
                }
            }

            const plain = result.text.trim();
            if (plain.length >= 20) {
                summary =
                    plain.length > SESSION_MEMORY_SUMMARY_MAX_CHARS
                        ? `${plain.slice(0, SESSION_MEMORY_SUMMARY_MAX_CHARS)}…`
                        : plain;
            }
        } catch {
            /** Mantém extrativo. */
        }

        return { history: recent, summary, compacted: true };
    }
}

/** No-op: nunca compacta (replay / testes sem custo LLM). */
export class NoopSessionMemoryAdapter implements SessionMemoryPort {
    async compactIfNeeded(input: CompactHistoryInput): Promise<CompactHistoryResult> {
        return {
            history: input.history,
            summary: input.existingSummary?.trim() || null,
            compacted: false,
        };
    }
}
