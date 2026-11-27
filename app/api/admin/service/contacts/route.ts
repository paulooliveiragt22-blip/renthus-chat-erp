import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

type Hit = { name: string; phone: string; source: "cliente" | "conversa" };

function cleanQuery(raw: string): string {
    return raw.replace(/[%_,.()]/g, "").trim().slice(0, 40);
}

export async function GET(req: Request) {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const query = cleanQuery(new URL(req.url).searchParams.get("q") ?? "");
    if (query.length < 2) return NextResponse.json({ contacts: [] });

    const pattern = `"%${query.replace(/"/g, "")}%"`;
    const [customers, threads] = await Promise.all([
        ctx.admin
            .from("customers")
            .select("name, phone_e164")
            .eq("company_id", ctx.companyId)
            .or(`name.ilike.${pattern},phone_e164.ilike.${pattern}`)
            .limit(8),
        ctx.admin
            .from("whatsapp_threads")
            .select("profile_name, phone_e164")
            .eq("company_id", ctx.companyId)
            .or(`profile_name.ilike.${pattern},phone_e164.ilike.${pattern}`)
            .limit(8),
    ]);

    const byPhone = new Map<string, Hit>();
    for (const row of customers.data ?? []) {
        const phone = typeof row.phone_e164 === "string" ? row.phone_e164 : "";
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (phone.length < 8 || name.length === 0) continue;
        byPhone.set(phone, { name, phone, source: "cliente" });
    }
    for (const row of threads.data ?? []) {
        const phone = typeof row.phone_e164 === "string" ? row.phone_e164 : "";
        const name = typeof row.profile_name === "string" ? row.profile_name.trim() : "";
        if (phone.length < 8 || name.length === 0 || byPhone.has(phone)) continue;
        byPhone.set(phone, { name, phone, source: "conversa" });
    }

    return NextResponse.json({ contacts: [...byPhone.values()].slice(0, 8) });
}
