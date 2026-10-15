/**
 * GET  /api/admin/ai-wallet — saldo IA
 * PATCH /api/admin/ai-wallet — auto-recharge + crédito manual de pack (admin)
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    creditAiPack,
    ensureAiWallet,
    loadAiOrderAverage,
    setAiWalletAutorecharge,
} from "@/lib/billing/aiWallet";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    try {
        const [wallet, orderAverage] = await Promise.all([
            ensureAiWallet(ctx.admin, ctx.companyId),
            loadAiOrderAverage(ctx.admin, ctx.companyId),
        ]);
        return NextResponse.json({ ok: true, wallet, orderAverage });
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

        const wallet = await setAiWalletAutorecharge(ctx.admin, ctx.companyId, {
            enabled: body.autoRechargeEnabled,
            packCents: body.autoRechargePackCents,
            updateEnabled: body.autoRechargeEnabled !== undefined,
            updatePack: body.autoRechargePackCents !== undefined,
        });
        return NextResponse.json({ ok: true, wallet });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
