/**
 * lib/chatbot/parsers/ParserFactory.ts
 *
 * Orquestrador da cadeia de fallback:
 *   Nível 1 — Regex / Fuse.js (OrderParserService): pedidos diretos, rápido, sem custo
 *   Nível 2 — Claude Haiku (Anthropic SDK): intent classification + casos complexos
 *   Nível 3 — Modo Assistido (ativa fluxo guiado via catálogo)
 *
 * Retorna ParseResultWithMeta compatível com processMessage.ts.
 * Loga cada tentativa em bot_logs via ParserLogger (inclui tokens e custo).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParseIntentResult, ProductForSearch } from "../OrderParserService";
import { parseWithClaude, type ClaudeParserConfig, type MessageIntent } from "./ClaudeParser";
import { parseWithRegex } from "./RegexParser";
import { logParserResult } from "../services/ParserLogger";
import { alertParserFallback } from "../services/AlertService";

export interface ParserFactoryParams {
    admin:        SupabaseClient;
    companyId:    string;
    threadId:     string;
    messageId:    string;
    input:        string;
    products:     ProductForSearch[];
    claudeConfig?: ClaudeParserConfig;
    /** Step atual da sessão (para filtro de catálogo e contexto de prompt) */
    step?:           string;
    cartSummary?:    string;
    /** Última pergunta enviada pelo bot — ancora a interpretação do próximo input */
    lastBotQuestion?: string;
    /** Última intenção classificada — evita viradas bruscas de contexto */
    lastIntent?:     string;
}

export type ParseResultWithMeta = ParseIntentResult & {
    _parserLevel:   1 | 2 | 3;
    _fallbackUsed:  boolean;
    _responseTimeMs: number;
    _intent?:       MessageIntent;
};

/** Retorna true se o resultado é acionável (não é uma falha) */
function isActionable(result: ParseIntentResult): boolean {
    return result.action === "add_to_cart" || result.action === "confirm_order";
}

/**
 * Retorna true se o resultado indica uma intent não-order detectada pelo LLM.
 * Nesses casos não há fallback adicional — o LLM entendeu que não é um pedido.
 */
function isNonOrderIntent(result: ParseIntentResult): boolean {
    const intent = (result as any)._intent as MessageIntent | undefined;
    return !!intent && intent !== "order";
}

export async function parseWithFactory(
    params: ParserFactoryParams
): Promise<ParseResultWithMeta> {
    const { admin, companyId, threadId, messageId, input, products, claudeConfig, step, cartSummary, lastBotQuestion, lastIntent } = params;
    const t0 = Date.now();

    // ── Nível 1: Regex / Fuse.js ──────────────────────────────────────────────
    // Pedidos diretos e claros resolvidos aqui em <1ms, sem custo de tokens.
    // Ex: "2 heineken", "3 skol lata 600", "1 brahma e 2 gelo"
    let level1Result: ParseIntentResult | null = null;
    try {
        level1Result = await parseWithRegex(input, products);
    } catch (err) {
        console.warn("[ParserFactory] Regex failed:", (err as any)?.message);
    }

    if (level1Result && isActionable(level1Result)) {
        const ms = Date.now() - t0;
        logParserResult(admin, {
            companyId, threadId, waMessageId: messageId,
            input,
            parserLevel:    1,
            fallbackUsed:   false,
            responseTimeMs: ms,
            action:         level1Result.action,
        }).catch(() => {});
        return {
            ...level1Result,
            _parserLevel:    1,
            _fallbackUsed:   false,
            _responseTimeMs: ms,
        };
    }

    // ── Nível 2: Claude Haiku ─────────────────────────────────────────────────
    // Regex não resolveu → Claude para intent classification e casos complexos:
    // linguagem ambígua, perguntas sobre produto, mistura produto+endereço, chitchat.
    let level2Result: (ParseIntentResult & { _intent?: MessageIntent; _tokensInput?: number; _tokensOutput?: number }) | null = null;
    try {
        level2Result = await parseWithClaude(input, products, {
            ...claudeConfig,
            step:            step            ?? "",
            cartSummary:     cartSummary     ?? "",
            lastBotQuestion: lastBotQuestion ?? "",
            lastIntent:      lastIntent      ?? "",
        });
    } catch (err) {
        console.warn("[ParserFactory] Claude failed:", (err as any)?.message);
    }

    // Se Claude detectou intent não-order (product_question, order_status, chitchat…)
    // → retorna imediatamente; o Regex nunca classifica intenções, então não há fallback
    if (level2Result && isNonOrderIntent(level2Result)) {
        const ms = Date.now() - t0;
        logParserResult(admin, {
            companyId, threadId, waMessageId: messageId,
            input,
            parserLevel:    2,
            fallbackUsed:   true,
            responseTimeMs: ms,
            action:         level2Result.action,
            intent:         (level2Result as any)._intent,
            confidence:     (level2Result as any)._confidence ?? null,
            tokensInput:    level2Result._tokensInput  ?? null,
            tokensOutput:   level2Result._tokensOutput ?? null,
            errorHint:      `regex: ${level1Result?.action ?? "exception"}`,
        }).catch(() => {});
        return {
            ...level2Result,
            _parserLevel:    2,
            _fallbackUsed:   true,
            _responseTimeMs: ms,
            _intent:         (level2Result as any)._intent,
        };
    }

    if (level2Result && isActionable(level2Result)) {
        const ms = Date.now() - t0;
        logParserResult(admin, {
            companyId, threadId, waMessageId: messageId,
            input,
            parserLevel:    2,
            fallbackUsed:   true,
            responseTimeMs: ms,
            action:         level2Result.action,
            intent:         (level2Result as any)._intent,
            confidence:     (level2Result as any)._confidence ?? null,
            tokensInput:    level2Result._tokensInput  ?? null,
            tokensOutput:   level2Result._tokensOutput ?? null,
            errorHint:      `regex: ${level1Result?.action ?? "exception"}`,
        }).catch(() => {});
        alertParserFallback(admin, {
            companyId, threadId,
            level: 2,
            inputText:  input,
            errorHint:  `regex: ${level1Result?.action ?? "exception"}`,
        }).catch(() => {});
        return {
            ...level2Result,
            _parserLevel:    2,
            _fallbackUsed:   true,
            _responseTimeMs: ms,
            _intent:         (level2Result as any)._intent,
        };
    }

    // ── Nível 3: Modo Assistido ───────────────────────────────────────────────
    const finalResult: ParseIntentResult = level2Result ?? level1Result ?? {
        action:       "low_confidence",
        message:      "Não foi possível interpretar o pedido",
        confidence:   0,
        contextUpdate: {},
    };

    const withAssistedFlag: ParseIntentResult = {
        ...finalResult,
        contextUpdate: {
            ...(finalResult as any).contextUpdate,
            parser_mode: "assisted",
        },
    } as any;

    const ms = Date.now() - t0;
    logParserResult(admin, {
        companyId, threadId, waMessageId: messageId,
        input,
        parserLevel:    3,
        fallbackUsed:   true,
        responseTimeMs: ms,
        action:         finalResult.action,
        errorHint:      "both regex and claude failed",
    }).catch(() => {});
    alertParserFallback(admin, {
        companyId, threadId,
        level: 3,
        inputText:  input,
        errorHint:  "both regex and claude failed",
    }).catch(() => {});

    return {
        ...withAssistedFlag,
        _parserLevel:    3,
        _fallbackUsed:   true,
        _responseTimeMs: ms,
    };
}
