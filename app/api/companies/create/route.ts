// app/api/companies/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
}

// Admin client (service_role) - usado somente no backend
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
    try {
        // 1) Autenticação: pegar token do Authorization header
        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return NextResponse.json({ error: "Authorization header required" }, { status: 401 });
        }
        const parts = authHeader.split(" ");
        if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
            return NextResponse.json({ error: "Invalid authorization header" }, { status: 401 });
        }
        const token = parts[1];

        // 2) Validar token chamando /auth/v1/user para obter o usuário (sub)
        const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: SUPABASE_SERVICE_ROLE_KEY, // permite rodar a chamada de forma segura
            },
        });

        if (!userResp.ok) {
            return NextResponse.json({ error: "Invalid user token" }, { status: 401 });
        }

        const userJson = await userResp.json();
        const creatorUserId = userJson?.id;
        if (!creatorUserId) {
            return NextResponse.json({ error: "Unable to determine user id from token" }, { status: 401 });
        }

        // 3) Ler body (espera um objeto: { company: { name, ... } } ou apenas { name, ... })
        const body = await req.json();
        const companyPayload = body.company ?? body;

        if (!companyPayload || typeof companyPayload !== "object" || !companyPayload.name) {
            return NextResponse.json({ error: "company payload with name is required" }, { status: 400 });
        }

        // 4) Chamar a RPC create_company_and_owner no banco usando service_role
        // Passa o creator_uuid (do token validado) e payload (json)
        const rpcParams = {
            creator_uuid: creatorUserId,
            payload: companyPayload,
        };

        const { data, error } = await supabaseAdmin.rpc("create_company_and_owner", rpcParams);

        if (error) {
            console.error("RPC error create_company_and_owner:", error);
            // Se for um erro de validação do RPC, devolva 400; caso contrário 500
            // Supabase retorna codigo e details; aqui tratamos genericamente.
            return NextResponse.json({ error: error.message || "Error creating company" }, { status: 400 });
        }

        // data normalmente é um array com a linha retornada pela function
        // Ex.: [{ company_id: 'uuid', company: { ... } }]
        const result = Array.isArray(data) ? data[0] : data;

        return NextResponse.json({ company: result?.company ?? null, company_id: result?.company_id ?? null }, { status: 201 });
    } catch (err: any) {
        console.error("Server error in companies/create:", err);
        return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
    }
}
