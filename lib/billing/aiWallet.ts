/**
 * Carteira de crédito IA: incluso 10% do plano/mês + packs prepaid.
 * Debita texto (LLM) e STT (áudio). Sem saldo: trava a IA (perfil degradado).
 *
 * Preços STT: ver `lib/billing/sttPricing.ts` (OpenAI estimated $/min).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSubscription } from "@/lib/billing/entitlements";
import { PLAN_CATALOG, normalizePlanKey } from "@/lib/billing/planCatalog";
import {
    estimateSttCostBrlCents,
    normalizeSttDurationSec,
    sttUsdPerMinute,
} from "@/lib/billing/sttPricing";
import { estimateLlmCostBrlCents } from "@/lib/billing/llmPricing";

export {
    estimateSttCostBrlCents,
    estimateSttDurationFromBytes,
    normalizeSttDurationSec,
    sttUsdPerMinute,
    STT_OPUS_BYTES_PER_SEC,
} from "@/lib/billing/sttPricing";

export { estimateLlmCostBrlCents, resolveLlmRates } from "@/lib/billing/llmPricing";

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

function includedBudgetForPlan(planKey: string | null): number {
    const k = normalizePlanKey(planKey);
    if (!k) return PLAN_CATALOG.essencial.aiIncludedCents;
    return PLAN_CATALOG[k].aiIncludedCents;
}

export async function ensureAiWallet(
    admin: SupabaseClient,
    companyId: string
): Promise<AiWalletSnapshot> {
    const ym = yearMonthUtc();
    const sub = await getActiveSubscription(admin, companyId);
    const budget = includedBudgetForPlan(sub?.plan_key ?? null);

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
    let snap = await ensureAiWallet(admin, companyId);
    if (snap.remainingTotalCents > 0) return true;
    const recharged = await tryAutoRechargeAiWallet(admin, companyId);
    if (!recharged) return false;
    snap = await ensureAiWallet(admin, companyId);
    return snap.remainingTotalCents > 0;
}

/**
 * Se auto-recarga estiver ligada e o saldo estiver baixo/zerado, cobra o pack
 * no cartão salvo (Pagar.me) e credita a carteira.
 */
export async function tryAutoRechargeAiWallet(
    admin: SupabaseClient,
    companyId: string
): Promise<boolean> {
    const snap = await ensureAiWallet(admin, companyId);
    if (!snap.autoRechargeEnabled || !snap.autoRechargePackCents) return false;
    if (snap.remainingTotalCents > 50) return false;

    const pack = snap.autoRechargePackCents as 1000 | 2000 | 5000;
    if (pack !== 1000 && pack !== 2000 && pack !== 5000) return false;

    // Debounce: não disparar outra recarga se já houve pack nos últimos 15 min
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: recent } = await admin
        .from("company_ai_ledger")
        .select("id, meta, created_at")
        .eq("company_id", companyId)
        .eq("kind", "pack_credit")
        .gte("created_at", since)
        .limit(10);
    const recentAuto = (recent ?? []).some(
        (r) =>
            r.meta &&
            typeof r.meta === "object" &&
            (r.meta as { source?: string }).source === "auto_recharge_card"
    );
    if (recentAuto) return false;

    const { data: pagarmeSub } = await admin
        .from("pagarme_subscriptions")
        .select("pagarme_customer_id")
        .eq("company_id", companyId)
        .maybeSingle();
    const customerId = pagarmeSub?.pagarme_customer_id;
    if (!customerId || typeof customerId !== "string") {
        console.warn("[aiWallet] auto-recharge: sem pagarme_customer_id", companyId);
        return false;
    }

    try {
        const { createOrderWithSavedCard, isOrderCreditPaid, listCustomerCards } = await import(
            "@/lib/billing/pagarme"
        );
        const cards = await listCustomerCards(customerId);
        const cardId = cards.find((c) => c.status === "active" || !c.status)?.id ?? cards[0]?.id;
        if (!cardId) {
            console.warn("[aiWallet] auto-recharge: sem cartão salvo", companyId);
            return false;
        }

        const brl = (pack / 100).toFixed(2).replace(".", ",");
        const order = await createOrderWithSavedCard({
            amountCents: pack,
            description: `Crédito IA automático Renthus — R$ ${brl}`,
            itemCode: `ai_pack_auto_${pack}`,
            customerId,
            cardId,
            metadata: {
                type: "ai_pack",
                company_id: companyId,
                pack_cents: String(pack),
                source: "auto_recharge",
            },
        });

        if (!isOrderCreditPaid(order)) {
            console.warn("[aiWallet] auto-recharge: cartão não aprovado", order.id, order.status);
            return false;
        }

        await creditAiPack(admin, companyId, pack, {
            pagarme_order_id: order.id,
            source: "auto_recharge_card",
        });
        return true;
    } catch (e) {
        console.warn("[aiWallet] auto-recharge falhou:", e);
        return false;
    }
}

/** Debita incluso primeiro; depois prepaid. Retorna false se não houver saldo. */
export async function debitAiUsage(
    admin: SupabaseClient,
    companyId: string,
    costCents: number,
    meta?: Record<string, unknown>
): Promise<boolean> {
    if (costCents <= 0) return true;
    const snap = await ensureAiWallet(admin, companyId);
    if (snap.remainingTotalCents < costCents) return false;

    let left = costCents;
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
        void tryAutoRechargeAiWallet(admin, companyId).catch(() => {});
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
    await admin.from("company_ai_ledger").insert({
        company_id: companyId,
        kind: "pack_credit",
        amount_cents: packCents,
        meta: { pack_cents: packCents, ...(meta ?? {}) },
    });
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
        `Para confirmar o valor alto, toque *Confirmar* de novo ou digite *CONFIRMAR*.`
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
