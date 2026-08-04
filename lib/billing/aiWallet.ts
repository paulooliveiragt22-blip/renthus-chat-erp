/**
 * Carteira de crédito IA (Haiku): incluso 10% do plano/mês + packs prepaid.
 * Sem saldo: trava só a IA (motor cai no Flow/Starter).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSubscription } from "@/lib/billing/entitlements";
import { PLAN_CATALOG, normalizePlanKey } from "@/lib/billing/planCatalog";

/** Anthropic Haiku 4.5 — USD por 1M tokens */
const HAIKU_INPUT_USD_PER_M = 1;
const HAIKU_OUTPUT_USD_PER_M = 5;

function yearMonthUtc(d = new Date()): string {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
}

function usdBrlRate(): number {
    const n = Number(process.env.AI_USD_BRL_RATE ?? "5.5");
    return Number.isFinite(n) && n > 0 ? n : 5.5;
}

/** Custo em centavos BRL a partir do uso Anthropic. */
export function estimateHaikuCostBrlCents(inputTokens: number, outputTokens: number): number {
    const usd =
        (Math.max(0, inputTokens) / 1_000_000) * HAIKU_INPUT_USD_PER_M +
        (Math.max(0, outputTokens) / 1_000_000) * HAIKU_OUTPUT_USD_PER_M;
    return Math.max(1, Math.ceil(usd * usdBrlRate() * 100));
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
    const snap = await ensureAiWallet(admin, companyId);
    return snap.remainingTotalCents > 0;
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

type AnthropicUsageLike = {
    input_tokens?: number | null;
    output_tokens?: number | null;
};

/** Debita carteira a partir do `usage` da resposta Anthropic (best-effort). */
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
    const cost = estimateHaikuCostBrlCents(inputTokens, outputTokens);
    try {
        await debitAiUsage(admin, companyId, cost, {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            ...(meta ?? {}),
        });
    } catch (e) {
        console.warn("[aiWallet] falha ao debitar uso Anthropic:", e);
    }
}
