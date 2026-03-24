/**
 * lib/chatbot/processMessage.ts
 *
 * Orquestrador do chatbot de delivery via WhatsApp + Meta Cloud API.
 *
 * Fluxo:
 *   welcome → main_menu → catalog_categories → catalog_products
 *   → cart → checkout_address → checkout_payment → checkout_confirm → done
 *                                                                     ↘ handover
 *
 * Delega toda a lógica para 3 camadas:
 *   1. intentDetector  — intenções globais (reset, handover, cancelar, saudação)
 *   2. parserChain     — cadeia Regex → Claude → Fallback
 *   3. stepRouter      — roteamento por session.step
 */

// ─── Re-exports para compatibilidade ─────────────────────────────────────────

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session } from "./types";
export type { DisplayableVariant } from "./displayHelpers";

// ─── Imports ──────────────────────────────────────────────────────────────────

import type { ProcessMessageParams } from "./types";
import type { CompanyConfig } from "./types";
import { getOrCreateSession } from "./session";
import { getCompanyInfo } from "./db/company";
import { detectGlobalIntents } from "./middleware/intentDetector";
import { runParserChain } from "./middleware/parserChain";
import { routeByStep } from "./router/stepRouter";

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId } = params;

    const input = params.text.trim();
    if (!input) return;

    // ── 1. Verifica bot ativo e carrega config ────────────────────────────────
    const { data: botRows } = await admin
        .from("chatbots")
        .select("id, config")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    if (!botRows?.length) {
        console.warn("[chatbot] Nenhum chatbot ativo para company:", companyId);
        return;
    }

    const botConfig  = (botRows[0]?.config as Record<string, unknown>) ?? {};
    const [company, session] = await Promise.all([
        getCompanyInfo(admin, companyId),
        getOrCreateSession(admin, threadId, companyId),
    ]);

    const config: CompanyConfig = {
        name:      company?.name ?? "nossa loja",
        settings:  company?.settings ?? {},
        botConfig,
    };

    // ── 2. Intenções globais (reset, handover, cancel, greeting) ──────────────
    const detected = await detectGlobalIntents(params, session, config);
    if (detected.handled) return;

    // ── 3. Parser chain (regex → claude → fallback) ───────────────────────────
    const chainResult = await runParserChain(params, session, config);
    if (chainResult.handled) return;

    // ── 4. Roteamento por step ────────────────────────────────────────────────
    await routeByStep(params, session, config);
}
