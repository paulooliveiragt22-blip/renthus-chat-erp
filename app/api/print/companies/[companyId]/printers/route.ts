// app/api/print/companies/[companyId]/printers/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { verifyAgentByApiKey } from "@/lib/print/agents";

export async function GET(req: Request, { params }: { params: { companyId: string } }) {
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const agent = await verifyAgentByApiKey(auth);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const companyId = params.companyId;
    if (String(agent.company_id) !== String(companyId)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.from("printers").select("*").eq("company_id", companyId).eq("is_active", true);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ printers: data || [] });
}

// ----------- NOVO: POST para registrar impressora via servidor ----------
export async function POST(req: Request, { params }: { params: { companyId: string } }) {
    const companyId = params.companyId;

    // 1) verifica sessão do usuário no servidor (cookies)
    const serverSupabase = await createServerClient();
    const { data: userData, error: userErr } = await serverSupabase.auth.getUser();

    if (userErr || !userData?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) verifica se o usuário é membro ativo da company (usando service role)
    const admin = createAdminClient();
    const { data: membership, error: mErr } = await admin
        .from("company_users")
        .select("role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if (mErr) {
        return NextResponse.json({ error: mErr.message }, { status: 500 });
    }
    if (!membership || !membership.is_active) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 3) lê body e insere usando admin (service role), que ignora RLS
    try {
        const body = await req.json();

        const payload = {
            company_id: companyId,
            name: body.name,
            type: body.type ?? "network",
            format: body.format ?? "receipt",
            auto_print: body.auto_print ?? false,
            interval_seconds: Number(body.interval_seconds ?? 0),
            is_active: body.is_active ?? true,
            config: body.config ?? {},
        };

        const { data: inserted, error: insertErr } = await admin
            .from("printers")
            .insert([payload])
            .select("*")
            .single();

        if (insertErr) {
            return NextResponse.json({ error: insertErr.message }, { status: 500 });
        }

        return NextResponse.json({ printer: inserted });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Invalid body" }, { status: 400 });
    }
}
