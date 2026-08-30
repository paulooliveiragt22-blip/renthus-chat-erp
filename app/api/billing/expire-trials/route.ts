/**
 * POST /api/billing/expire-trials
 *
 * Cron diário (Vercel, 09:00 BRT) — vercel.json: "0 10 * * *" (UTC)
 *
 * Transforma trials expirados em pending_payment (se havia escolha de plano)
 * ou pending_setup (se nunca escolheram). Marca empresas como is_active=false.
 *
 * Importante: NÃO marca como abandoned — isso é função do mark-abandoned.
 * Aqui só fechamos o trial e exigimos pagamento.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { billingLog } from "@/lib/billing/billingLog";

export const runtime = "nodejs";

const EXPIRE_BATCH_LIMIT = 100;

export async function POST(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader, {
        vercelCronHeader: req.headers.get("x-vercel-cron"),
    });
    if (authError) return authError;

    const admin = createAdminClient();
    const now = new Date();

    const results = {
        expired: 0,
        alreadyExpired: 0,
        errors: [] as string[],
    };

    // 1. Buscar trials vencidos.
    const { data: dueTrials, error: fetchErr } = await admin
        .from("pagarme_subscriptions")
        .select(`id, company_id, plan, status, trial_ends_at, last_paid_at, never_paid_at,
                 companies (id, is_active)`)
        .eq("status", "trial")
        .not("trial_ends_at", "is", null)
        .lte("trial_ends_at", now.toISOString())
        .limit(EXPIRE_BATCH_LIMIT + 1);

    if (fetchErr) {
        console.error("[expire-trials] Erro ao buscar trials:", fetchErr.message);
        await billingLog(admin, null, "expire_trials_error", {
            phase: "fetch",
            error: fetchErr.message,
        });
        return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const trials = (dueTrials ?? []).slice(0, EXPIRE_BATCH_LIMIT);
    if ((dueTrials ?? []).length > EXPIRE_BATCH_LIMIT) {
        results.errors.push("truncated: more trials than batch limit, will process on next run");
    }
    results.expired = trials.length;

    for (const sub of trials) {
        try {
            // Decidir o próximo status:
            //   - Tem plano escolhido (mesmo que nunca tenha pagado) → pending_payment
            //   - Sem plano (trial puro) → pending_setup (precisa escolher e pagar setup)
            const hasPlanChoice = sub.plan != null && String(sub.plan).trim() !== "";
            const nextStatus = hasPlanChoice ? "pending_payment" : "pending_setup";

            // Update na sub
            const { error: subErr } = await admin
                .from("pagarme_subscriptions")
                .update({
                    status: nextStatus,
                    last_status_change_at: now.toISOString(),
                })
                .eq("id", sub.id)
                .eq("status", "trial"); // optimistic lock

            if (subErr) {
                if (subErr.code === "2046" || subErr.code === "PGRST204") {
                    results.alreadyExpired++;
                    continue;
                }
                console.error(`[expire-trials] Erro update sub ${sub.id}:`, subErr.message);
                results.errors.push(`${sub.id}: ${subErr.message}`);
                continue;
            }

            // Desativar empresa (mas NÃO marcar abandoned — o mark-abandoned cuida disso)
            const { error: compErr } = await admin
                .from("companies")
                .update({ is_active: false })
                .eq("id", sub.company_id);

            if (compErr) {
                console.warn(`[expire-trials] Não consegui desativar company ${sub.company_id}:`, compErr.message);
                // Não falhamos o cron por causa disso.
            }

            await billingLog(admin, sub.company_id, "trial_expired", {
                subId: sub.id,
                nextStatus,
                trialEndsAt: sub.trial_ends_at,
                plan: sub.plan,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[expire-trials] Exceção ${sub.id}:`, msg);
            results.errors.push(`${sub.id}: ${msg}`);
        }
    }

    if (results.errors.length > 0) {
        Sentry.captureMessage("[expire-trials] Algumas subscriptions falharam", "warning");
    }

    await billingLog(admin, null, "expire_trials_done", {
        expired: results.expired,
        alreadyExpired: results.alreadyExpired,
        errors: results.errors.length,
    });

    return NextResponse.json({
        ok: true,
        ...results,
    });
}
