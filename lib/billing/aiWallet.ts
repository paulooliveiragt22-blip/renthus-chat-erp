/**
 * Carteira de crédito IA: incluso 10% do plano/mês + packs prepaid.
 * Debita texto (LLM) e STT (áudio). Sem saldo: trava a IA (perfil degradado).
 *
 * Preços STT: ver `lib/billing/sttPricing.ts` (OpenAI estimated $/min).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAiIncludedBudget } from "@/lib/billing/loadCommercialPlanPricing";
import {
    estimateSttCostBrlCents,
    normalizeSttDurationSec,
    sttUsdPerMinute,
} from "@/lib/billing/sttPricing";
import { estimateLlmCostBrlCents } from "@/lib/billing/llmPricing";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";

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

function yearMonthUtc(d = new Date()): string {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
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
    autoRechargeEnabled: boolean;
    autoRechargePackCents: number | null;
};

export async function ensureAiWallet(
    admin: SupabaseClient,
    companyId: string
): Promise<AiWalletSnapshot> {
    const ym = yearMonthUtc();
    const budget = await loadAiIncludedBudget(admin, companyId);

    const { data: row } = await admin
        .from("company_ai_wallets")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();

    if (!row) {
        await admin.from("company_ai_wallets").upsert({
            company_id: companyId,
            period_ym: ym,
            included_budget_cents: budget,
            included_spent_cents: 0,
            prepaid_balance_cents: 0,
            updated_at: new Date().toISOString(),
        });
        return {
            periodYm: ym,
            includedBudgetCents: budget,
            includedSpentCents: 0,
            prepaidBalanceCents: 0,
            remainingIncludedCents: budget,
            remainingTotalCents: budget,
            autoRechargeEnabled: false,
            autoRechargePackCents: null,
        };
    }

    let includedBudget = Number(row.included_budget_cents ?? budget);
    let includedSpent = Number(row.included_spent_cents ?? 0);
    let prepaid = Number(row.prepaid_balance_cents ?? 0);
    let periodYm = String(row.period_ym ?? ym);

    if (periodYm !== ym) {
        includedBudget = budget;
        includedSpent = 0;
        periodYm = ym;
        await admin
            .from("company_ai_wallets")
            .update({
                period_ym: ym,
                included_budget_cents: budget,
                included_spent_cents: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("company_id", companyId);
        await admin.from("company_ai_ledger").insert({
            company_id: companyId,
            kind: "period_reset",
            amount_cents: budget,
            meta: { period_ym: ym },
        });
    } else if (includedBudget !== budget) {
        includedBudget = budget;
        await admin
            .from("company_ai_wallets")
            .update({
                included_budget_cents: budget,
                updated_at: new Date().toISOString(),
            })
            .eq("company_id", companyId);
    }

    const remainingIncluded = Math.max(0, includedBudget - includedSpent);
    return {
        periodYm,
        includedBudgetCents: includedBudget,
        includedSpentCents: includedSpent,
        prepaidBalanceCents: prepaid,
        remainingIncludedCents: remainingIncluded,
        remainingTotalCents: remainingIncluded + prepaid,
        autoRechargeEnabled: Boolean(row.auto_recharge_enabled),
        autoRechargePackCents:
            row.auto_recharge_pack_cents == null ? null : Number(row.auto_recharge_pack_cents),
    };
}

export async function canUseAi(admin: SupabaseClient, companyId: string): Promise<boolean> {
    const snap = await ensureAiWallet(admin, companyId);
    if (snap.remainingTotalCents > 0) return true;
    const { enqueueAiRechargeIfNeeded } = await import("@/lib/billing/enqueueAiRecharge");
    void enqueueAiRechargeIfNeeded(admin, companyId).catch(() => {});
    return false;
}

/**
 * @deprecated Auto-recarga via outbox (ai_recharge_jobs + cron). Não chamar inline.
 */
export async function tryAutoRechargeAiWallet(
    admin: SupabaseClient,
    companyId: string
): Promise<boolean> {
    const { enqueueAiRechargeIfNeeded } = await import("@/lib/billing/enqueueAiRecharge");
    return enqueueAiRechargeIfNeeded(admin, companyId);
}

/** Debita incluso primeiro; depois prepaid. Retorna false se não houver saldo. */
export async function debitAiUsage(
    admin: SupabaseClient,
    companyId: string,
    costCents: number,
    meta?: Record<string, unknown>
): Promise<boolean> {
    const capped = clampAiDebitCents(costCents);
    if (capped <= 0) return true;
    if (capped < Math.floor(costCents)) {
        console.warn("[aiWallet] débito limitado pelo teto B13", {
            companyId,
            requested: Math.floor(costCents),
            capped,
        });
    }
    const snap = await ensureAiWallet(admin, companyId);
    if (snap.remainingTotalCents < capped) return false;

    let left = capped;
    let includedSpent = snap.includedSpentCents;
    let prepaid = snap.prepaidBalanceCents;
    const fromIncluded = Math.min(left, snap.remainingIncludedCents);
    if (fromIncluded > 0) {
        includedSpent += fromIncluded;
        left -= fromIncluded;
        await admin.from("company_ai_ledger").insert({
            company_id: companyId,
            kind: "included_debit",
            amount_cents: -fromIncluded,
            meta: meta ?? {},
        });
    }
    if (left > 0) {
        prepaid -= left;
        await admin.from("company_ai_ledger").insert({
            company_id: companyId,
            kind: "prepaid_debit",
            amount_cents: -left,
            meta: meta ?? {},
        });
    }

    await admin
        .from("company_ai_wallets")
        .update({
            included_spent_cents: includedSpent,
            prepaid_balance_cents: Math.max(0, prepaid),
            updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);

    const remTotal =
        Math.max(0, snap.includedBudgetCents - includedSpent) + Math.max(0, prepaid);
    if (remTotal <= 50) {
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
    await ensureAiWallet(admin, companyId);

    const orderId =
        meta &&
        typeof meta.pagarme_order_id === "string" &&
        meta.pagarme_order_id.trim()
            ? meta.pagarme_order_id.trim()
            : null;
    if (orderId) {
        const { data: dup } = await admin
            .from("company_ai_ledger")
            .select("id")
            .eq("company_id", companyId)
            .eq("kind", "pack_credit")
            .filter("meta->>pagarme_order_id", "eq", orderId)
            .maybeSingle();
        if (dup?.id) {
            return ensureAiWallet(admin, companyId);
        }
    }

    const { data } = await admin
        .from("company_ai_wallets")
        .select("prepaid_balance_cents")
        .eq("company_id", companyId)
        .maybeSingle();
    const next = Number(data?.prepaid_balance_cents ?? 0) + packCents;
    await admin
        .from("company_ai_wallets")
        .update({
            prepaid_balance_cents: next,
            updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);

    const { error: ledgerErr } = await admin.from("company_ai_ledger").insert({
        company_id: companyId,
        kind: "pack_credit",
        amount_cents: packCents,
        meta: { pack_cents: packCents, ...(meta ?? {}) },
    });
    if (ledgerErr && !isUniqueViolation(ledgerErr)) {
        throw new Error(ledgerErr.message);
    }
    await admin
        .from("company_ai_wallets")
        .update({
            auto_recharge_last_error: null,
            updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);
    return ensureAiWallet(admin, companyId);
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
};

/**
 * Debita carteira a partir do `usage` LLM (Anthropic ou OpenAI via adapter).
 * Prefira passar `model` em `meta` (ou 4º arg) — sem modelo usa fallback caro.
 */
export async function debitFromAnthropicUsage(
    admin: SupabaseClient,
    companyId: string,
    usage: AnthropicUsageLike | null | undefined,
    meta?: Record<string, unknown>
): Promise<void> {
    if (!companyId || !usage) return;
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    if (inputTokens <= 0 && outputTokens <= 0) return;
    const model =
        typeof meta?.model === "string" && meta.model.trim()
            ? meta.model.trim()
            : null;
    const cost = estimateLlmCostBrlCents(model, inputTokens, outputTokens);
    try {
        await debitAiUsage(admin, companyId, cost, {
            kind: "llm",
            model: model ?? "unknown",
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            ...(meta ?? {}),
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

/**
 * Debita carteira pelo STT (áudio → texto). Best-effort.
 * Retorna false se não houver saldo (chamador deve ter checado `canUseAi` antes).
 */
export async function debitFromSttUsage(
    admin: SupabaseClient,
    companyId: string,
    usage: SttUsageLike | null | undefined,
    meta?: Record<string, unknown>
): Promise<boolean> {
    if (!companyId || !usage) return true;
    const durationSec = normalizeSttDurationSec(usage.durationSec);
    const cost = estimateSttCostBrlCents(usage.model, durationSec);
    try {
        return await debitAiUsage(admin, companyId, cost, {
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
