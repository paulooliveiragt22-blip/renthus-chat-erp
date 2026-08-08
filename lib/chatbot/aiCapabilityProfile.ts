/**
 * Perfil de capacidade da IA — um motor PRO, três orçamentos.
 * Não confundir com `CommercialPlanKey` (essencial/pro/market).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSubscription } from "@/lib/billing/entitlements";
import { canUseAi, isAiEnabledInBotConfig } from "@/lib/billing/aiWallet";
import { normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";

export type AiCapabilityTier = "degradado" | "basico" | "avancado";

export type AiToolName = "search_produtos" | "get_order_hints" | "prepare_order_draft";

export type AiCapabilityProfile = {
    tier: AiCapabilityTier;
    /** Plano comercial resolvido (null se sem assinatura). */
    planKey: CommercialPlanKey | null;
    provider: "anthropic" | "openai";
    model: string;
    maxToolRounds: number;
    maxHistoryTurns: number;
    aiTimeoutMs: number;
    tools: AiToolName[];
    sttEnabled: boolean;
    /** false = zero LLM (intent regex-only + routeStage direct_reply). */
    llmEnabled: boolean;
};

const ALL_TOOLS: AiToolName[] = ["search_produtos", "get_order_hints", "prepare_order_draft"];

function configuredProvider(): "anthropic" | "openai" {
    const p = (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();
    return p === "openai" ? "openai" : "anthropic";
}

function configuredModel(provider: "anthropic" | "openai"): string {
    const fromEnv = process.env.LLM_MODEL?.trim();
    if (fromEnv) return fromEnv;
    return provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001";
}

function profileForPlan(planKey: CommercialPlanKey): Omit<AiCapabilityProfile, "planKey"> {
    const provider = configuredProvider();
    const model = configuredModel(provider);
    const base = {
        provider,
        model,
        tools: [...ALL_TOOLS] as AiToolName[],
        sttEnabled: true,
        llmEnabled: true,
        /**
         * `generateText` cobre o turno inteiro (todas as etapas do loop de tools) numa única
         * chamada — o abortSignal usa este teto por completo, não por etapa. Forces
         * determinísticos (ver ai.service.ts: shouldForceSearchForDeclaredPendingTerms /
         * shouldForcePrepareAfterEmbalagemChoice) podem adicionar 1-2 idas e voltas extras à
         * Anthropic no mesmo turno; 15s era justo demais nesse cenário.
         */
        aiTimeoutMs: 20_000,
    };
    if (planKey === "essencial") {
        return {
            ...base,
            tier: "basico",
            maxToolRounds: 4,
            maxHistoryTurns: 8,
        };
    }
    return {
        ...base,
        tier: "avancado",
        maxToolRounds: 12,
        maxHistoryTurns: 24,
    };
}

function degradadoProfile(planKey: CommercialPlanKey | null): AiCapabilityProfile {
    const provider = configuredProvider();
    return {
        tier: "degradado",
        planKey,
        provider,
        model: configuredModel(provider),
        maxToolRounds: 0,
        maxHistoryTurns: 0,
        aiTimeoutMs: 15_000,
        tools: [],
        sttEnabled: false,
        llmEnabled: false,
    };
}

/**
 * Resolve perfil: sem plano / IA off / sem crédito / erro → `degradado`.
 * essencial → `basico`; pro|market → `avancado` (mesmo modelo; orçamento diferente).
 */
export async function resolveAiCapabilityProfile(
    admin: SupabaseClient,
    companyId: string,
    botConfig?: Record<string, unknown> | null
): Promise<AiCapabilityProfile> {
    try {
        const sub = await getActiveSubscription(admin, companyId);
        const planKey = normalizePlanKey(sub?.plan_key ?? null);
        if (!planKey) return degradadoProfile(null);

        if (!isAiEnabledInBotConfig(botConfig ?? null)) {
            return degradadoProfile(planKey);
        }

        const ok = await canUseAi(admin, companyId);
        if (!ok) return degradadoProfile(planKey);

        return { ...profileForPlan(planKey), planKey };
    } catch (e) {
        console.warn("[aiCapabilityProfile] falha ao resolver, fallback degradado:", e);
        return degradadoProfile(null);
    }
}

export const AI_DEGRADED_ORDER_MESSAGE_PT_BR =
    "No momento o assistente com IA está indisponível (crédito esgotado ou desligado).\n\n" +
    "Você pode:\n" +
    "• Digitar *cardápio* para ver o menu\n" +
    "• Digitar *status* para acompanhar um pedido\n" +
    "• Digitar *atendente* para falar com uma pessoa";
