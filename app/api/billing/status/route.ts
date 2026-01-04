import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { getActiveSubscription, getEnabledFeatures, checkLimit } from "@/lib/billing/entitlements";

export const runtime = "nodejs";

export async function GET() {
    try {
        // Página admin: só owner/admin
        const ctx = await requireCompanyAccess(["owner", "admin"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId } = ctx;

        const sub = await getActiveSubscription(admin, companyId);
        const features = await getEnabledFeatures(admin, companyId);

        // Uso atual do mês (sem "incrementar" nada)
        // Se não existir subscription/limite, isso ainda retorna used=0 e limit=null.
        const whatsappUsage = await checkLimit(admin, companyId, "whatsapp_messages", 0);

        return NextResponse.json({
            ok: true,
            company_id: companyId,
            subscription: sub, // null se não existir
            enabled_features: Array.from(features.values()),
            enabled_features_count: features.size,
            usage: {
                whatsapp_messages: whatsappUsage,
            },
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
    }
}
