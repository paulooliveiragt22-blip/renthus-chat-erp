/**
 * Enfileira auto-recarga IA — chat/debit não chama Pagar.me.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAiWallet } from "@/lib/billing/aiWallet";
import { billingLog } from "@/lib/billing/billingLog";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";

const LOW_BALANCE_THRESHOLD_CENTS = 50;

export async function enqueueAiRechargeIfNeeded(
    admin: SupabaseClient,
    companyId: string
): Promise<boolean> {
    const snap = await ensureAiWallet(admin, companyId);
    if (!snap.autoRechargeEnabled || !snap.autoRechargePackCents) return false;
    if (snap.remainingTotalCents > LOW_BALANCE_THRESHOLD_CENTS) return false;

    const pack = snap.autoRechargePackCents;
    if (pack !== 1000 && pack !== 2000 && pack !== 5000) return false;

    const { error } = await admin.from("ai_recharge_jobs").insert({
        company_id: companyId,
        pack_cents: pack,
        status: "pending",
    });

    if (error) {
        if (isUniqueViolation(error)) return false;
        console.warn("[enqueueAiRecharge] insert failed:", error.message);
        return false;
    }

    billingLog("ai_recharge", "enqueued", { company_id: companyId, pack_cents: pack });
    return true;
}
