/**
 * POST /api/ativar — persiste step do wizard /ativar (P1.4).
 *
 * action: "advance" | "complete" | "skip"
 * step?: number (0–5)
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

const MAX_STEP = 5;

type Body = {
    action?: "advance" | "complete" | "skip";
    step?: number;
};

export async function GET() {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "full",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const { data, error } = await ctx.admin
            .from("companies")
            .select("onboarding_step, onboarding_completed_at, nome_fantasia, whatsapp_phone")
            .eq("id", ctx.companyId)
            .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({
            ok: true,
            step: data?.onboarding_step ?? 0,
            completed: data?.onboarding_completed_at != null,
            company: {
                nome_fantasia: data?.nome_fantasia ?? null,
                whatsapp_phone: data?.whatsapp_phone ?? null,
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erro interno";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "full",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const body = (await req.json()) as Body;
        const action = body.action ?? "advance";

        if (action === "complete" || action === "skip") {
            const { error } = await ctx.admin
                .from("companies")
                .update({
                    onboarding_completed_at: new Date().toISOString(),
                    onboarding_step: MAX_STEP,
                    is_active: true,
                })
                .eq("id", ctx.companyId);

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ ok: true, completed: true });
        }

        const step = Number(body.step);
        if (!Number.isFinite(step) || step < 0 || step > MAX_STEP) {
            return NextResponse.json({ error: "Step inválido (0–5)." }, { status: 400 });
        }

        const { error } = await ctx.admin
            .from("companies")
            .update({ onboarding_step: step })
            .eq("id", ctx.companyId);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, step });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Erro interno";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
