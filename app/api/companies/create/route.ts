// app/api/companies/create/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type AddressPayload = {
    cep?: string;
    endereco?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
};

type CompanyPayload = {
    cnpj?: string;
    razao_social?: string;
    nome_fantasia?: string;
    phone?: string;
    address?: AddressPayload;
    city?: string;
};

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { company?: CompanyPayload; user_id?: string };
        if (!body?.company) return NextResponse.json({ error: "company required" }, { status: 400 });

        const supabase = await createServerClient();
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userData?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userId = userData.user.id;

        // If caller passed user_id, ensure it matches the authenticated user
        if (body.user_id && body.user_id !== userId) {
            return NextResponse.json({ error: "user_id mismatch" }, { status: 403 });
        }

        const company = body.company;
        // minimal validation
        const name = (company.nome_fantasia || company.razao_social || "").trim();
        if (!name) return NextResponse.json({ error: "company name required" }, { status: 400 });

        const city = (company.address?.cidade || company.city || null) as string | null;
        const phone = (company.phone || null) as string | null;

        const admin = createAdminClient();

        // create company row - companies table (schema: name, city, phone, ...)
        const { data: compData, error: compErr } = await admin
            .from("companies")
            .insert([{ name, city, phone }])
            .select("id")
            .single();

        if (compErr || !compData?.id) {
            return NextResponse.json({ error: compErr?.message || "Failed to create company" }, { status: 500 });
        }

        const companyId = compData.id as string;

        // create company_users mapping (user becomes owner)
        const { data: cuData, error: cuErr } = await admin
            .from("company_users")
            .insert([{ company_id: companyId, user_id: userId, role: "owner", is_active: true }])
            .select("id")
            .single();

        if (cuErr) {
            // rollback company if mapping failed
            try {
                await admin.from("companies").delete().eq("id", companyId);
            } catch (e) {
                // no-op
            }
            return NextResponse.json({ error: cuErr?.message || "Failed to associate user to company" }, { status: 500 });
        }

        // optionally: store more company metadata somewhere — currently schema doesn't have cnpj/razao columns.
        // If you want to persist the extra fields (cnpj, razao_social, address), create a company_meta table or add columns to companies.

        // set workspace cookie (same behavior as /api/workspace/select)
        cookies().set("renthus_company_id", companyId, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 30, // 30 dias
        });

        return NextResponse.json({ ok: true, company_id: companyId });
    } catch (err: any) {
        console.error("companies/create error:", err);
        return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
    }
}
