/**
 * /api/signup/complete
 *
 * GET  ?token=xxx  → retorna dados da empresa para pré-preencher o formulário
 * POST             → atualiza empresa + define senha no Auth
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET — carrega dados pelo token
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
        return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: company, error } = await admin
        .from("companies")
        .select("id, name, email, whatsapp_phone, meta, senha_definida, onboarding_completed_at")
        .eq("onboarding_token", token)
        .maybeSingle();

    if (error || !company) {
        return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 404 });
    }

    // Busca plano ativo
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("plan, status")
        .eq("company_id", company.id)
        .maybeSingle();

    return NextResponse.json({
        company_id:   company.id,
        company_name: company.name,
        email:        company.email,
        whatsapp:     company.whatsapp_phone,
        cnpj:         (company.meta as any)?.cnpj ?? "",
        plan:         sub?.plan ?? null,
        senha_definida: company.senha_definida,
        onboarding_completed_at: company.onboarding_completed_at,
    });
}

// ---------------------------------------------------------------------------
// POST — salva dados adicionais + define senha
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            token:         string;
            razao_social?: string;
            cep?:          string;
            endereco?:     string;
            numero?:       string;
            complemento?:  string;
            bairro?:       string;
            cidade?:       string;
            uf?:           string;
            password:      string;
        };

        const { token, password } = body;

        if (!token || !password || password.length < 8) {
            return NextResponse.json(
                { error: "Token e senha (mín. 8 caracteres) são obrigatórios" },
                { status: 400 }
            );
        }

        const admin = createAdminClient();

        // Busca empresa pelo token
        const { data: company } = await admin
            .from("companies")
            .select("id, email, name")
            .eq("onboarding_token", token)
            .maybeSingle();

        if (!company) {
            return NextResponse.json({ error: "Token inválido" }, { status: 404 });
        }

        // Busca ou cria usuário Auth pelo email
        const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
        let authUserId = userList?.users?.find((u) => u.email === company.email)?.id;

        if (!authUserId) {
            // Webhook ainda não criou o usuário — cria agora
            const { data: created } = await admin.auth.admin.createUser({
                email:         company.email,
                password,
                email_confirm: false,
                user_metadata: { company_id: company.id, company_name: company.name },
            });
            authUserId = created?.user?.id;

            if (authUserId) {
                await admin
                    .from("company_users")
                    .upsert(
                        { company_id: company.id, user_id: authUserId, role: "owner" },
                        { onConflict: "company_id,user_id" }
                    );
            }
        } else {
            // Atualiza senha do usuário existente
            await admin.auth.admin.updateUserById(authUserId, { password });
        }

        // Atualiza dados complementares da empresa
        const addressMeta: Record<string, string> = {};
        if (body.cep)        addressMeta.cep        = body.cep.replaceAll(/\D/g, "");
        if (body.endereco)   addressMeta.logradouro  = body.endereco.trim();
        if (body.numero)     addressMeta.numero       = body.numero.trim();
        if (body.complemento) addressMeta.complemento = body.complemento.trim();
        if (body.bairro)     addressMeta.bairro       = body.bairro.trim();
        if (body.cidade)     addressMeta.cidade       = body.cidade.trim();
        if (body.uf)         addressMeta.uf           = body.uf.trim().toUpperCase();

        const currentMeta = await admin
            .from("companies")
            .select("meta")
            .eq("id", company.id)
            .single()
            .then((r) => (r.data?.meta as Record<string, unknown>) ?? {});

        await admin
            .from("companies")
            .update({
                ...(body.razao_social ? { name: body.razao_social.trim() } : {}),
                meta:                    { ...currentMeta, ...addressMeta },
                senha_definida:          true,
                onboarding_completed_at: new Date().toISOString(),
            })
            .eq("id", company.id);

        return NextResponse.json({ ok: true, email: company.email });
    } catch (err: any) {
        console.error("[signup/complete] Erro:", err?.message ?? err);
        return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
    }
}
