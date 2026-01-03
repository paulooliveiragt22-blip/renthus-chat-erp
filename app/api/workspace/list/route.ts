import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
    const supabase = await createServerClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();

    if (userErr || !userData?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // 1) memberships (SERVICE ROLE)
    const { data: memberships, error: mErr } = await admin
        .from("company_users")
        .select("company_id, role, is_active")
        .eq("user_id", userData.user.id)
        .eq("is_active", true);

    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

    const companyIds = (memberships ?? []).map((m) => m.company_id).filter(Boolean);

    if (!companyIds.length) {
        return NextResponse.json({ companies: [] });
    }

    // 2) companies
    const { data: companies, error: cErr } = await admin
        .from("companies")
        .select("id, name")
        .in("id", companyIds);

    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    const roleByCompany = new Map<string, string>();
    for (const m of memberships ?? []) roleByCompany.set(m.company_id, m.role);

    const result = (companies ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        role: roleByCompany.get(c.id) ?? "member",
    }));

    return NextResponse.json({ companies: result });
}
