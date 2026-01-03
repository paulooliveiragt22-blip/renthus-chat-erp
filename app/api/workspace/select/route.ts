import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const { company_id } = (await req.json()) as { company_id?: string };
    if (!company_id) return NextResponse.json({ error: "company_id required" }, { status: 400 });

    // auth via cookies (supabase session)
    const supabase = await createServerClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // validate membership (service role)
    const admin = createAdminClient();
    const { data: membership } = await admin
        .from("company_users")
        .select("id, is_active, role")
        .eq("company_id", company_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if (!membership || !membership.is_active) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // set cookie (workspace)
    cookies().set("renthus_company_id", company_id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 dias
    });

    return NextResponse.json({ ok: true, company_id });
}
