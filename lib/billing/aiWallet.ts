/**
 * Carteira de crédito IA: incluso 10% do plano/mês + packs prepaid.
 * Saldo só muda pelas RPCs (ADR 0016). Sem saldo que cubra o último débito, a IA não inicia.
 *
 * Preços STT: ver `lib/billing/sttPricing.ts` (OpenAI estimated $/min).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    estimateSttCostBrlCents,
    normalizeSttDurationSec,
    sttUsdPerMinute,
} from "@/lib/billing/sttPricing";
import { estimateLlmCostBrlCents, usdBrlRateFromEnv } from "@/lib/billing/llmPricing";

export {
    estimateSttCostBrlCents,
    estimateSttDurationFromBytes,
    normalizeSttDurationSec,
    sttUsdPerMinute,
    STT_OPUS_BYTES_PER_SEC,
} from "@/lib/billing/sttPricing";

export { estimateLlmCostBrlCents, resolveLlmRates } from "@/lib/billing/llmPricing";

/**
 * Teto por débito único (B13) — evita bug/flood de tokens esvaziar a carteira numa chamada.
 * Turnos legítimos Haiku/Groq ficam bem abaixo; Sonnet caro também é limitado.
 */
export const AI_WALLET_MAX_SINGLE_DEBIT_CENTS = 500;

/** Normaliza e aplica o teto de débito por chamada. */
export function clampAiDebitCents(costCents: number): number {
    if (!Number.isFinite(costCents) || costCents <= 0) return 0;
    return Math.min(Math.floor(costCents), AI_WALLET_MAX_SINGLE_DEBIT_CENTS);
}

/** @deprecated Use `estimateLlmCostBrlCents(model, …)`. Mantido: Haiku 4.5. */
export function estimateHaikuCostBrlCents(inputTokens: number, outputTokens: number): number {
    return estimateLlmCostBrlCents("claude-haiku-4-5", inputTokens, outputTokens);
}

export type AiWalletSnapshot = {
    periodYm: string;
    includedBudgetCents: number;
    includedSpentCents: number;
    prepaidBalanceCents: number;
    remainingIncludedCents: number;
    remainingTotalCents: number;
    reservedCents: number;
    lastDebitCents: number;
    autoRechargeEnabled: boolean;
    autoRechargePackCents: number | null;
    /** Fim do mês de crédito incluso. O que sobrar não passa para o mês seguinte. */
    includedPeriodEnd: string | null;
};

export type AiOrderUsageAverage = {
    orderCount: number;
    avgCalls: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgCostCents: number;
};

export type AiTurnBegin = {
    allowed: boolean;
    reused: boolean;
    reason: string | null;
};

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function asRecord(data: unknown): Record<string, unknown> {
    if (data && typeof data === "object" && !Array.isArray(data)) {
        return data as Record<string, unknown>;
    }
    throw new Error("rpc_ai_wallet_empty");
}

function mapSnapshot(data: unknown): AiWalletSnapshot {
    const row = asRecord(data);
    return {
        periodYm: String(row.period_ym ?? ""),
        includedBudgetCents: num(row.included_budget_cents),
        includedSpentCents: num(row.included_spent_cents),
        prepaidBalanceCents: num(row.prepaid_balance_cents),
        remainingIncludedCents: num(row.remaining_included_cents),
        remainingTotalCents: num(row.remaining_total_cents),
        reservedCents: num(row.reserved_cents),
        lastDebitCents: num(row.last_debit_cents),
        autoRechargeEnabled: Boolean(row.auto_recharge_enabled),
        autoRechargePackCents:
            row.auto_recharge_pack_cents == null ? null : num(row.auto_recharge_pack_cents),
        includedPeriodEnd:
            row.included_period_end == null || row.included_period_end === ""
                ? null
                : String(row.included_period_end),
    };
}

/** Disponível para o próximo turno. Espelha `rpc_begin_ai_turn`. */
export function aiTurnAllowed(remainingTotalCents: number, lastDebitCents: number): boolean {
    if (remainingTotalCents <= 0) return false;
    if (lastDebitCents > 0 && remainingTotalCents < lastDebitCents) return false;
    return true;
}

async function rpcJson(
    admin: SupabaseClient,
    fn: string,
    args: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);
    return asRecord(data);
}

export async function ensureAiWallet(
    admin: SupabaseClient,
    companyId: string
): Promise<AiWalletSnapshot> {
    const row = await rpcJson(admin, "rpc_ensure_ai_wallet", { p_company_id: companyId });
    return mapSnapshot(row);
}

export async function canUseAi(admin: SupabaseClient, companyId: string): Promise<boolean> {
    const snap = await ensureAiWallet(admin, companyId);
    if (!aiTurnAllowed(snap.remainingTotalCents, snap.lastDebitCents)) {
        const { enqueueAiRechargeIfNeeded } = await import("@/lib/billing/enqueueAiRecharge");
        void enqueueAiRechargeIfNeeded(admin, companyId).catch(() => {});
        return false;
    }
    return true;
}

export async function beginAiTurn(
    admin: SupabaseClient,
    companyId: string,
    idempotencyKey: string,
    holdCents = 1
): Promise<AiTurnBegin> {
    const row = await rpcJson(admin, "rpc_begin_ai_turn", {
        p_company_id: companyId,
        p_hold_cents: Math.max(1, Math.floor(holdCents)),
        p_idempotency_key: idempotencyKey,
    });
    return {
        allowed: Boolean(row.allowed),
        reused: Boolean(row.reused),
        reason: row.reason == null ? null : String(row.reason),
    };
}

export async function releaseAiTurn(
    admin: SupabaseClient,
    companyId: string,
    turnKey: string
): Promise<void> {
    await rpcJson(admin, "rpc_release_ai_turn", {
        p_company_id: companyId,
        p_idempotency_key: turnKey,
    });
}

export async function settleAiTurn(
    admin: SupabaseClient,
    companyId: string,
    turnKey: string,
    idempotencyKey: string,
    costCents: number,
    meta?: Record<string, unknown>
): Promise<boolean> {
    const capped = clampAiDebitCents(costCents);
    const row = await rpcJson(admin, "rpc_settle_ai_turn", {
        p_company_id: companyId,
        p_turn_key: turnKey,
        p_idempotency_key: idempotencyKey,
        p_cost_cents: capped,
        p_meta: meta ?? {},
    });
    if (row.ok === false) {
        console.warn("[aiWallet] liquidação recusada", { companyId, reason: row.reason });
        return false;
    }
    const charged = num(row.charged_cents);
    const remHint = row.exhausted === true || (capped > 0 && charged < capped);
    if (remHint) {
        const { enqueueAiRechargeIfNeeded } = await import("@/lib/billing/enqueueAiRecharge");
        void enqueueAiRechargeIfNeeded(admin, companyId).catch(() => {});
    }
    return true;
}

export async function creditAiPack(
    admin: SupabaseClient,
    companyId: string,
    packCents: 1000 | 2000 | 5000,
    meta?: Record<string, unknown>
): Promise<AiWalletSnapshot> {
    const orderId =
        meta && typeof meta.pagarme_order_id === "string" && meta.pagarme_order_id.trim()
            ? meta.pagarme_order_id.trim()
            : null;
    const row = await rpcJson(admin, "rpc_credit_ai_pack", {
        p_company_id: companyId,
        p_pack_cents: packCents,
        p_pagarme_order_id: orderId,
        p_meta: meta ?? {},
    });
    return mapSnapshot(row);
}

export async function setAiWalletAutorecharge(
    admin: SupabaseClient,
    companyId: string,
    patch: {
        enabled?: boolean;
        packCents?: 1000 | 2000 | 5000 | null;
        lastError?: string | null;
        updateEnabled?: boolean;
        updatePack?: boolean;
        updateError?: boolean;
    }
): Promise<AiWalletSnapshot> {
    const row = await rpcJson(admin, "rpc_set_ai_wallet_autorecharge", {
        p_company_id: companyId,
        p_enabled: patch.enabled ?? null,
        p_pack_cents: patch.packCents ?? null,
        p_update_enabled: Boolean(patch.updateEnabled),
        p_update_pack: Boolean(patch.updatePack),
        p_last_error: patch.lastError ?? null,
        p_update_error: Boolean(patch.updateError),
    });
    return mapSnapshot(row);
}

export async function attributeAiOrderUsage(
    admin: SupabaseClient,
    companyId: string,
    orderId: string,
    threadId: string
): Promise<void> {
    const { error } = await admin.rpc("rpc_attribute_ai_order_usage", {
        p_company_id: companyId,
        p_order_id: orderId,
        p_thread_id: threadId,
    });
    if (error) {
        console.warn("[aiWallet] falha ao atribuir uso do pedido", error.message);
    }
}

export async function loadAiOrderAverage(
    admin: SupabaseClient,
    companyId: string
): Promise<AiOrderUsageAverage> {
    const row = await rpcJson(admin, "rpc_ai_order_usage_average", { p_company_id: companyId });
    return {
        orderCount: num(row.order_count),
        avgCalls: num(row.avg_calls),
        avgInputTokens: num(row.avg_input_tokens),
        avgOutputTokens: num(row.avg_output_tokens),
        avgCostCents: num(row.avg_cost_cents),
    };
}

export function isAiEnabledInBotConfig(config: Record<string, unknown> | null | undefined): boolean {
    if (!config || config.ai_enabled === undefined || config.ai_enabled === null) return true;
    return Boolean(config.ai_enabled);
}

export function parseHighValueConfirmPolicy(config: Record<string, unknown> | null | undefined): {
    enabled: boolean;
    amountBrl: number;
} {
    const enabled = Boolean(config?.high_value_confirm_enabled);
    const raw = Number(config?.high_value_confirm_amount_brl ?? 0);
    const amountBrl = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { enabled: enabled && amountBrl > 0, amountBrl };
}

/** Mensagem PT-BR pedindo segunda confirmação quando o pedido passa o limiar da loja. */
export function buildHighValueConfirmMessage(itemsTotal: number, amountBrl: number): string {
    const totalLabel = itemsTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const limLabel = amountBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return (
        `Este pedido totaliza *${totalLabel}* (acima de ${limLabel}).\n\n` +
        `Para confirmar o valor alto, toque *Confirmar* de novo.`
    );
}

type AnthropicUsageLike = {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_tokens?: number | null;
    cache_write_tokens?: number | null;
    no_cache_input_tokens?: number | null;
};

/**
 * Liquida um passo já reservado por `beginAiTurn` (a chave do turno é `meta.turn_key`).
 */
export async function debitFromAnthropicUsage(
    admin: SupabaseClient,
    companyId: string,
    usage: AnthropicUsageLike | null | undefined,
    meta?: Record<string, unknown>
): Promise<void> {
    if (!companyId || !usage) return;
    const turnKey = typeof meta?.turn_key === "string" ? meta.turn_key : "";
    const stepKey = typeof meta?.step_key === "string" ? meta.step_key : "";
    if (!turnKey || !stepKey) {
        console.warn("[aiWallet] débito LLM sem reserva", { companyId });
        return;
    }
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const cacheReadTokens = Number(usage.cache_read_tokens ?? meta?.cache_read_tokens ?? 0);
    const cacheWriteTokens = Number(usage.cache_write_tokens ?? meta?.cache_write_tokens ?? 0);
    const noCacheInputTokens =
        usage.no_cache_input_tokens != null
            ? Number(usage.no_cache_input_tokens)
            : meta?.no_cache_input_tokens != null
              ? Number(meta.no_cache_input_tokens)
              : undefined;
    if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
        return;
    }
    const model =
        typeof meta?.model === "string" && meta.model.trim() ? meta.model.trim() : null;
    const cost = estimateLlmCostBrlCents(model, inputTokens, outputTokens, usdBrlRateFromEnv(), {
        noCacheInputTokens,
        cacheReadTokens,
        cacheWriteTokens,
    });
    try {
        await settleAiTurn(admin, companyId, turnKey, stepKey, cost, {
            kind: "llm",
            model: model ?? "unknown",
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            ...(meta ?? {}),
            ...(cacheReadTokens > 0 || cacheWriteTokens > 0 || noCacheInputTokens != null
                ? {
                      cache_read_tokens: cacheReadTokens,
                      cache_write_tokens: cacheWriteTokens,
                      ...(noCacheInputTokens != null ? { no_cache_input_tokens: noCacheInputTokens } : {}),
                  }
                : {}),
        });
    } catch (e) {
        console.warn("[aiWallet] falha ao debitar uso LLM:", e);
    }
}

export type SttUsageLike = {
    model: string;
    durationSec: number;
    byteLength?: number;
};

/** Liquida STT já reservado. `meta.turn_key` e `meta.step_key` são obrigatórios. */
export async function debitFromSttUsage(
    admin: SupabaseClient,
    companyId: string,
    usage: SttUsageLike | null | undefined,
    meta?: Record<string, unknown>
): Promise<boolean> {
    if (!companyId || !usage) return true;
    const turnKey = typeof meta?.turn_key === "string" ? meta.turn_key : "";
    const stepKey = typeof meta?.step_key === "string" ? meta.step_key : "";
    if (!turnKey || !stepKey) return false;
    const durationSec = normalizeSttDurationSec(usage.durationSec);
    const cost = estimateSttCostBrlCents(usage.model, durationSec);
    try {
        return await settleAiTurn(admin, companyId, turnKey, stepKey, cost, {
            kind: "stt",
            model: usage.model,
            duration_sec: durationSec,
            usd_per_minute: sttUsdPerMinute(usage.model),
            byte_length: usage.byteLength ?? null,
            ...(meta ?? {}),
        });
    } catch (e) {
        console.warn("[aiWallet] falha ao debitar uso STT:", e);
        return false;
    }
}
