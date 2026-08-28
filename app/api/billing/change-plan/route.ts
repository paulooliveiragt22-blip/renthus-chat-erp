/**
 * POST /api/billing/change-plan
 *
 * Trial: qualquer plano comercial.
 * Active: só upgrade (essencial → pro → market).
 * Overdue / pending_payment / blocked: proibido (pague primeiro — D11).
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";
import { normalizePlanKey, parseCommercialPlanInput, planRank } from "@/lib/billing/planCatalog";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

type Body = { plan?: string };

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const { admin, companyId } = ctx;
        const body = (await req.json()) as Body;
        const planKey = parseCommercialPlanInput(body?.plan);
        if (!planKey) {
            return NextResponse.json(
                { error: "Plano inválido. Use 'essencial', 'pro' ou 'market'." },
                { status: 400 }
            );
        }

        const { data: row, error: fetchErr } = await admin
            .from("pagarme_subscriptions")
            .select("id, plan, status")
            .eq("company_id", companyId)
            .maybeSingle();

        if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
        if (!row?.id) {
            return NextResponse.json({ error: "Assinatura não encontrada para esta empresa." }, { status: 404 });
        }

        const st = String(row.status ?? "");
        const current = normalizePlanKey(String(row.plan ?? "")) ?? String(row.plan ?? "");

        if (
            st === "blocked" ||
            st === "cancelled" ||
            st === "pending_payment" ||
            st === "pending_setup" ||
            st === "overdue"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Não é possível alterar o plano nesta situação. Regularize o pagamento primeiro.",
                },
                { status: 400 }
            );
        }

        if (current === planKey) {
            return NextResponse.json({ ok: true, action: "noop", plan: current });
        }

        if (st === "trial") {
            const { error: upErr } = await admin
                .from("pagarme_subscriptions")
                .update({ plan: planKey })
                .eq("id", row.id);

            if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
            await syncLogicalSubscription(admin, companyId, planKey);
            return NextResponse.json({ ok: true, action: "changed", plan: planKey });
        }

        if (st === "active" && planRank(planKey) > planRank(current)) {
            const { error: upErr } = await admin
                .from("pagarme_subscriptions")
                .update({ plan: planKey })
                .eq("id", row.id);

            if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
            await syncLogicalSubscription(admin, companyId, planKey);
            return NextResponse.json({ ok: true, action: "upgraded", plan: planKey });
        }

        return NextResponse.json(
            {
                error: "Alteração de plano não permitida nesta situação (ex.: downgrade ou troca fora do trial).",
            },
            { status: 400 }
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
