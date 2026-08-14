/**
 * GET  /api/admin/ai-wallet — saldo IA
 * PATCH /api/admin/ai-wallet — auto-recharge + crédito manual de pack (admin)
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    creditAiPack,
    ensureAiWallet,
} from "@/lib/billing/aiWallet";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    try {
        const wallet = await ensureAiWallet(ctx.admin, ctx.companyId);
        return NextResponse.json({ ok: true, wallet });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = (await req.json().catch(() => ({}))) as {
        autoRechargeEnabled?: boolean;
        autoRechargePackCents?: 1000 | 2000 | 5000 | null;
        /** Crédito de pack (pagamento real via PIX/cartão virá depois; agora só owner/admin). */
        creditPackCents?: 1000 | 2000 | 5000;
    };

    try {
        if (body.creditPackCents === 1000 || body.creditPackCents === 2000 || body.creditPackCents === 5000) {
            const wallet = await creditAiPack(ctx.admin, ctx.companyId, body.creditPackCents, {
                source: "admin_manual",
            });
            return NextResponse.json({ ok: true, wallet, credited: body.creditPackCents });
        }

        await ensureAiWallet(ctx.admin, ctx.companyId);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.autoRechargeEnabled !== undefined) {
            patch.auto_recharge_enabled = Boolean(body.autoRechargeEnabled);
        }
        if (body.autoRechargePackCents !== undefined) {
            patch.auto_recharge_pack_cents = body.autoRechargePackCents;
        }
        const { error } = await ctx.admin
            .from("company_ai_wallets")
            .update(patch)
            .eq("company_id", ctx.companyId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const wallet = await ensureAiWallet(ctx.admin, ctx.companyId);
        return NextResponse.json({ ok: true, wallet });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
