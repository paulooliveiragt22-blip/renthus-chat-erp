/**
 * POST /api/billing/change-plan
 *
 * Durante o trial: alternar entre bot e complete.
 * Com assinatura ativa ou em atraso (não bloqueada): upgrade bot → complete apenas.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";

export const runtime = "nodejs";

type Body = { plan?: string };

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess(["owner", "admin"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId } = ctx;
        const body = (await req.json()) as Body;
        const plan = body?.plan;

        if (plan !== "bot" && plan !== "complete") {
            return NextResponse.json({ error: "Plano inválido. Use 'bot' ou 'complete'." }, { status: 400 });
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

        const st     = String(row.status ?? "");
        const current = String(row.plan ?? "");

        if (st === "blocked" || st === "cancelled") {
            return NextResponse.json(
                { error: "Não é possível alterar o plano com a assinatura bloqueada ou cancelada." },
                { status: 400 }
            );
        }

        if (current === plan) {
            return NextResponse.json({ ok: true, action: "noop", plan: current });
        }

        if (st === "trial") {
            const { error: upErr } = await admin
                .from("pagarme_subscriptions")
                .update({ plan })
                .eq("id", row.id);

            if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
            await syncLogicalSubscription(admin, companyId, plan);
            return NextResponse.json({ ok: true, action: "changed", plan });
        }

        if ((st === "active" || st === "overdue") && current === "bot" && plan === "complete") {
            const { error: upErr } = await admin
                .from("pagarme_subscriptions")
                .update({ plan })
                .eq("id", row.id);

            if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
            await syncLogicalSubscription(admin, companyId, plan);
            return NextResponse.json({ ok: true, action: "upgraded", plan });
        }

        return NextResponse.json(
            { error: "Alteração de plano não permitida nesta situação (ex.: downgrade ou troca fora do trial)." },
            { status: 400 }
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
