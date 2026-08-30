/**
 * POST /api/billing/mark-abandoned
 *
 * Cron diário (Vercel, 08:00 BRT) — vercel.json: "0 9 * * *" (UTC)
 *
 * Marca como "abandoned" empresas que:
 * 1. Têm subscription em pending_setup ou pending_payment
 * 2. companies.is_active = false
 * 3. never_paid_at é null E created_at + ABANDONED_GRACE_DAYS_D <= agora
 *
 * Abandoned é o estado intermediário entre "não pagou" e "blocked".
 * Permite que o inbound seja recebido com autoReply=reactivation, capturando
 * mensagens de clientes para ativar o owner via template WA.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { billingLog } from "@/lib/billing/billingLog";

export const runtime = "nodejs";

// Empresas com pending_setup/payment que nunca pagaram e estão inativas
// há mais de N dias são consideradas abandonadas.
const ABANDONED_GRACE_DAYS = 14;

export async function POST(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader, {
        vercelCronHeader: req.headers.get("x-vercel-cron"),
    });
    if (authError) return authError;

    const admin = createAdminClient();
    const now = new Date();
    const cutoff = new Date(now.getTime() - ABANDONED_GRACE_DAYS * 86_400_000);

    const results = {
        marked: 0,
        alreadyAbandoned: 0,
        errors: [] as string[],
    };

    // 1. Buscar subs que nunca pagaram, estão em status de "não começaram a pagar",
    //    e o owner abandonou (empresa inativa há tempo suficiente).
    const { data: staleSubs, error: fetchErr } = await admin
        .from("pagarme_subscriptions")
        .select(`id, company_id, status, never_paid_at, created_at, abandoned_at,
                 companies (id, is_active, created_at)`)
        .in("status", ["pending_setup", "pending_payment"])
        .is("abandoned_at", null)
        .eq("companies.is_active", false)
        .lte("pagarme_subscriptions.created_at", cutoff.toISOString());

    if (fetchErr) {
        console.error("[mark-abandoned] Erro ao buscar subs abandonadas:", fetchErr.message);
        billingLog("mark-abandoned", "mark_abandoned_error", {
            phase: "fetch",
            error: fetchErr.message,
        });
        return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const subs = staleSubs ?? [];
    results.marked = subs.length;

    for (const sub of subs) {
        try {
            const { error: updateErr } = await admin
                .from("pagarme_subscriptions")
                .update({
                    status: "abandoned",
                    abandoned_at: now.toISOString(),
                    last_status_change_at: now.toISOString(),
                })
                .eq("id", sub.id)
                .eq("status", sub.status); // optimistic lock

            if (updateErr) {
                // Se status mudou entre a leitura e o update (race condition),
                // não é erro real.
                if (updateErr.code === "2046" || updateErr.code === "PGRST204") {
                    results.alreadyAbandoned++;
                    continue;
                }
                console.error(`[mark-abandoned] Erro ao marcar ${sub.id}:`, updateErr.message);
                results.errors.push(`${sub.id}: ${updateErr.message}`);
                continue;
            }

            billingLog("mark-abandoned", "marked_abandoned", {
                subId: sub.id,
                companyId: sub.company_id,
                previousStatus: sub.status,
                neverPaidAt: sub.never_paid_at,
                createdAt: sub.created_at,
            });

            Sentry.addBreadcrumb?.({
                category: "billing",
                message: `marked_abandoned: sub=${sub.id} company=${sub.company_id}`,
                level: "info",
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[mark-abandoned] Exceção para ${sub.id}:`, msg);
            results.errors.push(`${sub.id}: ${msg}`);
        }
    }

    if (results.errors.length > 0) {
        Sentry.captureMessage("[mark-abandoned] Algumas subscriptions falharam", "warning");
    }

    billingLog("mark-abandoned", "mark_abandoned_done", {
        marked: results.marked,
        alreadyAbandoned: results.alreadyAbandoned,
        errors: results.errors.length,
    });

    return NextResponse.json({
        ok: true,
        ...results,
    });
}
