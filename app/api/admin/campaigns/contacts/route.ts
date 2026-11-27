import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { normalizeCampaignPhone } from "@/lib/campaigns/parsePhones";

export const runtime = "nodejs";

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const url = new URL(req.url);
    const raw = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const name = raw.replace(/[%_,.()]/g, "");
    const digits = raw.replace(/\D/g, "");
    if (name.length < 2 && digits.length < 4) {
        return NextResponse.json({ contacts: [] });
    }

    let filter = "";
    if (name.length >= 2) filter = `name.ilike.%${name}%`;
    if (digits.length >= 4) {
        const phone = `phone.ilike.%${digits}%,phone_e164.ilike.%${digits}%`;
        filter = filter ? `${filter},${phone}` : phone;
    }

    const { data, error } = await admin
        .from("customers")
        .select("id, name, phone, phone_e164")
        .eq("company_id", companyId)
        .or(filter)
        .order("name", { ascending: true })
        .limit(12);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        contacts: (data ?? []).flatMap((row) => {
            const phone =
                normalizeCampaignPhone(row.phone_e164 as string | null) ||
                normalizeCampaignPhone(row.phone as string | null);
            if (!phone) return [];
            return [{ id: row.id as string, name: String(row.name ?? "Sem nome"), phone }];
        }),
    });
}
