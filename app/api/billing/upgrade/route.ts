import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type Body = {
    plan_key: "mini_erp" | "full_erp";
    // opcional: se quiser já habilitar overage ao fazer upgrade
    allow_overage?: boolean;
};

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess(["owner", "admin"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId } = ctx;

        const body = (await req.json()) as Body;
        const planKey = body?.plan_key;

        if (planKey !== "mini_erp" && planKey !== "full_erp") {
            return NextResponse.json({ error: "Invalid plan_key. Use 'mini_erp' or 'full_erp'." }, { status: 400 });
        }

        const allowOverage = Boolean(body?.allow_overage);

        // Resolve plan_id a partir de plans.key
        const { data: plan, error: planErr } = await admin
            .from("plans")
            .select("id, key, name")
            .eq("key", planKey)
            .maybeSingle();

        if (planErr) return NextResponse.json({ error: planErr.message }, { status: 500 });
        if (!plan?.id) return NextResponse.json({ error: `Plan not found: ${planKey}` }, { status: 400 });

        // Subscription ativa atual (se houver)
        const { data: current, error: curErr } = await admin
            .from("subscriptions")
            .select("id, plan_id, allow_overage, status, started_at")
            .eq("company_id", companyId)
            .eq("status", "active")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });

        // Se já está no plano desejado, só atualiza allow_overage se necessário
        if (current?.id && current.plan_id === plan.id) {
            if (current.allow_overage !== allowOverage) {
                const { error: updErr } = await admin
                    .from("subscriptions")
                    .update({ allow_overage: allowOverage })
                    .eq("id", current.id);

                if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
            }

            return NextResponse.json({
                ok: true,
                action: "noop",
                message: "Already on requested plan",
                subscription_id: current.id,
                plan_key: planKey,
                allow_overage: allowOverage,
            });
        }

        // 1) encerra a subscription atual (se existir)
        if (current?.id) {
            const { error: endErr } = await admin
                .from("subscriptions")
                .update({ status: "ended", ended_at: new Date().toISOString() })
                .eq("id", current.id);

            if (endErr) return NextResponse.json({ error: endErr.message }, { status: 500 });
        }

        // 2) cria nova subscription ativa
        const { data: created, error: insErr } = await admin
            .from("subscriptions")
            .insert({
                company_id: companyId,
                plan_id: plan.id,
                status: "active",
                started_at: new Date().toISOString(),
                allow_overage: allowOverage,
            })
            .select("id, company_id, plan_id, status, started_at, allow_overage")
            .single();

        if (insErr || !created?.id) {
            return NextResponse.json({ error: insErr?.message || "Failed to create subscription" }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            action: "upgraded",
            subscription: created,
            plan: { key: plan.key, name: plan.name ?? null },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
    }
}
