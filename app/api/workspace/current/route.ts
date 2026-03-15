import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
    const cookieStore = cookies();
    const companyId = cookieStore.get("renthus_company_id")?.value ?? null;
    if (companyId) return NextResponse.json({ company_id: companyId });

    // Sem cookie: auto-seleciona a primeira empresa ativa do usuário
    const supabase = await createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return NextResponse.json({ company_id: null });

    const admin = createAdminClient();
    const { data: membership } = await admin
        .from("company_users")
        .select("company_id")
        .eq("user_id", userData.user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    const firstCompanyId = membership?.company_id ?? null;

    // Persiste o cookie para próximas requisições
    if (firstCompanyId) {
        cookieStore.set("renthus_company_id", firstCompanyId, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
        });
    }

    return NextResponse.json({ company_id: firstCompanyId });
}
