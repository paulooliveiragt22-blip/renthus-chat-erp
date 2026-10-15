import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    botReadinessChecks,
    botReadinessGaps,
    type BotReadinessFlags,
} from "@/lib/channels/botReadiness";

export const runtime = "nodejs";

type ReadinessQueryRow = {
    company_id: string;
    has_sale_price: boolean;
    has_stock: boolean;
    has_commercial_sigla: boolean;
    has_delivery_zone_fee: boolean;
    has_opening_hours: boolean;
    has_store_address: boolean;
    ready: boolean;
};

function flagsFromRow(row: ReadinessQueryRow): BotReadinessFlags {
    return {
        hasSalePrice: row.has_sale_price === true,
        hasStock: row.has_stock === true,
        hasCommercialSigla: row.has_commercial_sigla === true,
        hasDeliveryZoneFee: row.has_delivery_zone_fee === true,
        hasOpeningHours: row.has_opening_hours === true,
        hasStoreAddress: row.has_store_address === true,
    };
}

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { data, error } = await ctx.admin
        .from("v_sec_bot_readiness")
        .select(
            "company_id, has_sale_price, has_stock, has_commercial_sigla, has_delivery_zone_fee, has_opening_hours, has_store_address, ready"
        )
        .eq("company_id", ctx.companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "empresa_nao_encontrada" }, { status: 404 });

    const row = data as ReadinessQueryRow;
    const flags = flagsFromRow(row);
    return NextResponse.json({
        ready: row.ready === true,
        gaps: botReadinessGaps(flags),
        checks: botReadinessChecks(flags),
    });
}
