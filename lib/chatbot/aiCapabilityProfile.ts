/**
 * Perfil de capacidade da IA — um motor PRO, três orçamentos.
 * Não confundir com `CommercialPlanKey` (essencial/pro/market).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSubscription } from "@/lib/billing/entitlements";
import { canUseAi, isAiEnabledInBotConfig } from "@/lib/billing/aiWallet";
import { normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import type { OutboundMessage } from "@/src/types/contracts";
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_OLLAMA_MODEL, DEFAULT_GROQ_MODEL } from "@/src/pro/adapters/ai/modelProvider";

export type AiCapabilityTier = "degradado" | "basico" | "avancado";

/**
 * Motivo estável de degradação (ADR-0005 D6 / P0.11).
 * `llm_error` é setado no pipeline após falha de provider (não em `resolveAiCapabilityProfile`).
 */
export type AiDegradedReason =
    | "no_subscription"
    | "ai_disabled"
    | "ai_wallet_empty"
    | "profile_resolve_error"
    | "llm_error";

export type AiToolName = "search_produtos" | "get_order_hints" | "prepare_order_draft";

export type AiCapabilityProfile = {
    tier: AiCapabilityTier;
    /** Plano comercial resolvido (null se sem assinatura). */
    planKey: CommercialPlanKey | null;
    provider: "anthropic" | "openai" | "ollama" | "groq";
    model: string;
    maxToolRounds: number;
    maxHistoryTurns: number;
    aiTimeoutMs: number;
    tools: AiToolName[];
    sttEnabled: boolean;
    /** false = zero LLM (intent regex-only + routeStage direct_reply). */
    llmEnabled: boolean;
    /** Preenchido só quando `tier === "degradado"` (ou falha LLM no turno). */
    degradedReason?: AiDegradedReason | null;
};

/** Snapshot puro dos gates — testável sem I/O. */
export type AiCapabilityGateSnapshot = {
    planKey: CommercialPlanKey | null;
    aiEnabled: boolean;
    canUseAi: boolean;
    /** Falha ao ler subscription/wallet — não confundir com `no_subscription`. */
    resolveError?: boolean;
};

const ALL_TOOLS: AiToolName[] = ["search_produtos", "get_order_hints", "prepare_order_draft"];

/**
 * `companyOverride` vem de `company_settings.llm_provider` (buscado pelo chamador — ver
 * `runProInbound.ts` — nunca por uma query nova aqui dentro, pra não somar um 3º round-trip
 * sequencial a `getActiveSubscription`/`canUseAi`). Valor inválido/ausente cai no env global,
 * comportamento idêntico ao anterior.
 */
/** Exportada só para teste unitário direto (evita mockar toda a cadeia de subscription/wallet). */
export function configuredProvider(companyOverride?: string | null): "anthropic" | "openai" | "ollama" | "groq" {
    const override = (companyOverride ?? "").trim().toLowerCase();
    if (override === "anthropic" || override === "openai" || override === "ollama" || override === "groq") return override;
    const p = (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();
    if (p === "openai") return "openai";
    if (p === "ollama") return "ollama";
    if (p === "groq") return "groq";
    return "anthropic";
}

/** Exportada só para teste unitário direto (mesma razão de `configuredProvider`). */
export function configuredModel(provider: "anthropic" | "openai" | "ollama" | "groq"): string {
    const fromEnv = process.env.LLM_MODEL?.trim();
    if (fromEnv) return fromEnv;
    if (provider === "openai") return DEFAULT_OPENAI_MODEL;
    if (provider === "ollama") return DEFAULT_OLLAMA_MODEL;
    if (provider === "groq") return DEFAULT_GROQ_MODEL;
    return DEFAULT_ANTHROPIC_MODEL;
}

function profileForPlan(
    planKey: CommercialPlanKey,
    companyLlmProvider?: string | null
): Omit<AiCapabilityProfile, "planKey"> {
    const provider = configuredProvider(companyLlmProvider);
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
         * shouldForcePrepareAfterEmbalagemChoice) podem adicionar 1-2 idas e voltas extras
         * no mesmo turno (search → force respond_to_customer → prepare).
         *
         * 45s (avançado) / 30s (básico): Groq multi-step + toolChoice costuma 8–25s; 12s
         * (Fase 14) gerava `AI_TIMEOUT` / "Delay was aborted" em pedidos reais. Lambda
         * inbound tem timeout 120s — este teto ainda falha rápido sem travar o groupId.
         */
        aiTimeoutMs: 45_000,
    };
    if (planKey === "essencial") {
        return {
            ...base,
            tier: "basico",
            maxToolRounds: 3,
            maxHistoryTurns: 8,
            aiTimeoutMs: 30_000,
        };
    }
    return {
        ...base,
        tier: "avancado",
        maxToolRounds: 10,
        maxHistoryTurns: 24,
    };
}

function degradadoProfile(
    planKey: CommercialPlanKey | null,
    companyLlmProvider: string | null | undefined,
    reason: AiDegradedReason
): AiCapabilityProfile {
    const provider = configuredProvider(companyLlmProvider);
    return {
        tier: "degradado",
        planKey,
        provider,
        model: configuredModel(provider),
        maxToolRounds: 0,
        maxHistoryTurns: 0,
        aiTimeoutMs: 8_000,
        tools: [],
        sttEnabled: false,
        llmEnabled: false,
        degradedReason: reason,
    };
}

/**
 * Monta o perfil a partir dos gates já resolvidos (puro — sem I/O).
 * essencial → `basico`; pro|market → `avancado`; gates falhos → `degradado` + reason.
 */
export function profileFromCapabilityGates(
    gates: AiCapabilityGateSnapshot,
    companyLlmProvider?: string | null
): AiCapabilityProfile {
    if (gates.resolveError) {
        return degradadoProfile(null, companyLlmProvider, "profile_resolve_error");
    }
    if (!gates.planKey) {
        return degradadoProfile(null, companyLlmProvider, "no_subscription");
    }
    if (!gates.aiEnabled) {
        return degradadoProfile(gates.planKey, companyLlmProvider, "ai_disabled");
    }
    if (!gates.canUseAi) {
        return degradadoProfile(gates.planKey, companyLlmProvider, "ai_wallet_empty");
    }
    return {
        ...profileForPlan(gates.planKey, companyLlmProvider),
        planKey: gates.planKey,
        degradedReason: null,
    };
}

/**
 * Resolve perfil: sem plano / IA off / sem crédito / erro → `degradado`.
 * essencial → `basico`; pro|market → `avancado` (mesmo modelo; orçamento diferente).
 */
export async function resolveAiCapabilityProfile(
    admin: SupabaseClient,
    companyId: string,
    botConfig?: Record<string, unknown> | null,
    /** `company_settings.llm_provider` — buscado pelo chamador em paralelo, ver `runProInbound.ts`. */
    companyLlmProvider?: string | null
): Promise<AiCapabilityProfile> {
    try {
        const sub = await getActiveSubscription(admin, companyId);
        const planKey = normalizePlanKey(sub?.plan_key ?? null);
        const aiEnabled = isAiEnabledInBotConfig(botConfig ?? null);
        const walletOk = planKey && aiEnabled ? await canUseAi(admin, companyId) : false;
        return profileFromCapabilityGates(
            {
                planKey,
                aiEnabled,
                canUseAi: walletOk,
            },
            companyLlmProvider
        );
    } catch (e) {
        console.warn("[aiCapabilityProfile] falha ao resolver, fallback degradado:", e);
        return profileFromCapabilityGates(
            { planKey: null, aiEnabled: true, canUseAi: false, resolveError: true },
            companyLlmProvider
        );
    }
}

/** D6: oferecer cardápio web só em falha operacional de IA — nunca mascarar paywall. */
export function shouldOfferWebMenuOnAiDegraded(
    reason: AiDegradedReason | null | undefined
): boolean {
    return reason !== "no_subscription";
}

export const AI_DEGRADED_ORDER_MESSAGE_PT_BR =
    "No momento o assistente com IA está indisponível.\n\n" +
    "Você pode pedir pelo *cardápio*, digitar *status* para acompanhar um pedido " +
    "ou *atendente* para falar com uma pessoa.";

export const AI_DEGRADED_NO_SUBSCRIPTION_MESSAGE_PT_BR =
    "O atendimento automático desta loja está temporariamente indisponível. " +
    "Tente novamente mais tarde.";

/**
 * Outbound D6: texto + `cta_url` do cardápio (exceto `no_subscription`).
 * Puro — sem I/O.
 */
export function buildAiDegradedOutbound(opts: {
    webMenuUrl?: string | null;
    reason?: AiDegradedReason | null;
}): OutboundMessage[] {
    const reason = opts.reason ?? null;
    if (!shouldOfferWebMenuOnAiDegraded(reason)) {
        return [{ kind: "text", text: AI_DEGRADED_NO_SUBSCRIPTION_MESSAGE_PT_BR }];
    }

    const web = String(opts.webMenuUrl ?? "").trim();
    if (!web) {
        return [
            {
                kind: "text",
                text:
                    AI_DEGRADED_ORDER_MESSAGE_PT_BR +
                    "\n\nDigite *cardápio* quando o link estiver disponível na loja.",
            },
        ];
    }

    return [
        { kind: "text", text: AI_DEGRADED_ORDER_MESSAGE_PT_BR },
        {
            kind: "cta_url",
            ctaUrl: {
                bodyText: "Peça pelo cardápio enquanto a IA está indisponível:",
                displayText: "Abrir cardápio",
                url: web,
            },
        },
    ];
}