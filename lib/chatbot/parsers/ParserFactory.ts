/**
 * lib/chatbot/parsers/ParserFactory.ts
 *
 * Orquestrador da cadeia de fallback:
 *   Nível 1 — Claude Haiku (Anthropic SDK)
 *   Nível 2 — Regex / Fuse.js (OrderParserService)
 *   Nível 3 — Modo Assistido (ativa fluxo guiado via catálogo)
 *
 * Retorna ParseIntentResult compatível com processMessage.ts.
 * Loga cada tentativa em bot_logs via ParserLogger.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParseIntentResult, ProductForSearch } from "../OrderParserService";
import { parseWithClaude, type ClaudeParserConfig } from "./ClaudeParser";
import { parseWithRegex } from "./RegexParser";
import { logParserResult } from "../services/ParserLogger";
import { alertParserFallback } from "../services/AlertService";

export interface ParserFactoryParams {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    messageId: string;
    input: string;
    products: ProductForSearch[];
    claudeConfig?: ClaudeParserConfig;
}

export type ParseResultWithMeta = ParseIntentResult & {
    _parserLevel: 1 | 2 | 3;
    _fallbackUsed: boolean;
    _responseTimeMs: number;
};

/** Returns true if the result is actionable (not a failure) */
function isActionable(result: ParseIntentResult): boolean {
    return result.action === "add_to_cart" || result.action === "confirm_order";
}

export async function parseWithFactory(
    params: ParserFactoryParams
): Promise<ParseResultWithMeta> {
    const { admin, companyId, threadId, messageId, input, products, claudeConfig } = params;
    const t0 = Date.now();

    // ── Nível 1: Claude Haiku ─────────────────────────────────────────────────
    let level1Result: ParseIntentResult | null = null;
    try {
        level1Result = await parseWithClaude(input, products, claudeConfig);
    } catch (err) {
        console.warn("[ParserFactory] Claude failed:", (err as any)?.message);
    }

    if (level1Result && isActionable(level1Result)) {
        const ms = Date.now() - t0;
        logParserResult(admin, {
            companyId, threadId, waMessageId: messageId,
            input,
            parserLevel: 1,
            fallbackUsed: false,
            responseTimeMs: ms,
            action: level1Result.action,
            confidence: (level1Result as any)._confidence ?? null,
        }).catch(() => {});
        return { ...level1Result, _parserLevel: 1, _fallbackUsed: false, _responseTimeMs: ms };
    }

    // ── Nível 2: Regex / Fuse.js ──────────────────────────────────────────────
    let level2Result: ParseIntentResult | null = null;
    try {
        level2Result = await parseWithRegex(input, products);
    } catch (err) {
        console.warn("[ParserFactory] Regex failed:", (err as any)?.message);
    }

    if (level2Result && isActionable(level2Result)) {
        const ms = Date.now() - t0;
        logParserResult(admin, {
            companyId, threadId, waMessageId: messageId,
            input,
            parserLevel: 2,
            fallbackUsed: true,
            responseTimeMs: ms,
            action: level2Result.action,
        }).catch(() => {});
        alertParserFallback(admin, {
            companyId, threadId,
            level: 2,
            inputText: input,
            errorHint: level1Result ? `claude: ${level1Result.action}` : "claude: exception",
        }).catch(() => {});
        return { ...level2Result, _parserLevel: 2, _fallbackUsed: true, _responseTimeMs: ms };
    }

    // ── Nível 3: Modo Assistido ───────────────────────────────────────────────
    // Retorna o melhor resultado não-actionable disponível (preferindo o resultado
    // do nível 2 se houver, pois pode ter info de endereço útil)
    const finalResult: ParseIntentResult = level2Result ?? level1Result ?? {
        action: "low_confidence",
        message: "Não foi possível interpretar o pedido",
        confidence: 0,
        contextUpdate: {},
    };

    // Sinaliza modo assistido no contextUpdate para que processMessage.ts
    // possa ativar o fluxo guiado (catálogo) após esse resultado
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
        parserLevel: 3,
        fallbackUsed: true,
        responseTimeMs: ms,
        action: finalResult.action,
    }).catch(() => {});
    alertParserFallback(admin, {
        companyId, threadId,
        level: 3,
        inputText: input,
        errorHint: "both claude and regex failed",
    }).catch(() => {});

    return { ...withAssistedFlag, _parserLevel: 3, _fallbackUsed: true, _responseTimeMs: ms };
}
