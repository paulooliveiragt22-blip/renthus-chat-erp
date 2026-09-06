// app/api/agent/keys/route.ts
// GET    → lista agentes da empresa (sem hash)
// POST   → gera nova API key (agente novo); body { name? }
// PATCH  → rotaciona key de agente existente; body { agent_id } — plaintext UMA VEZ
// DELETE → revoga (desativa + scramble hash); body { agent_id }

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    generatePrintAgentKeyMaterial,
    revokePrintAgentApiKey,
    rotatePrintAgentApiKey,
} from "@/lib/print/rotatePrintAgentKey";

export const runtime = "nodejs";

export async function GET() {
    const access = await requireCapability("print.operate");
    if (!access.ok) return new NextResponse(access.error, { status: access.status });

    const admin = createAdminClient();
    const { data, error } = await admin
        .from("print_agents")
        .select("id, name, api_key_prefix, is_active, last_seen, created_at")
        .eq("company_id", access.companyId)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ agents: data ?? [] });
}

export async function POST(req: Request) {
    const access = await requireCompanyAccess({
        allowedRoles: ["owner", "admin"],
        mutating: true,
    });
    if (!access.ok) return new NextResponse(access.error, { status: access.status });

    const feat = await requirePlanFeature(access.admin, access.companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const defaultName = `Agente - ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const agentName: string = body?.name?.trim() || defaultName;

    const admin = createAdminClient();

    await admin
        .from("print_agents")
        .update({ is_active: false })
        .eq("company_id", access.companyId)
        .eq("is_active", true);

    const material = await generatePrintAgentKeyMaterial();

    const { data: agent, error: insertErr } = await admin
        .from("print_agents")
        .insert([
            {
                company_id: access.companyId,
                name: agentName,
                api_key_hash: material.hash,
                api_key_prefix: material.prefix,
                is_active: true,
            },
        ])
        .select("id, name, api_key_prefix, created_at")
        .single();

    if (insertErr || !agent) {
        return NextResponse.json(
            { error: insertErr?.message ?? "Erro ao criar agente" },
            { status: 500 }
        );
    }

    // Nunca logar material.apiKeyPlain
    return NextResponse.json({
        ok: true,
        agent_id: agent.id,
        agent_name: agent.name,
        api_key: material.apiKeyPlain,
        api_key_prefix: material.prefix,
    });
}

/** B7 — rotaciona key; key antiga passa a 401. */
export async function PATCH(req: Request) {
    const access = await requireCompanyAccess({
        allowedRoles: ["owner", "admin"],
        mutating: true,
    });
    if (!access.ok) return new NextResponse(access.error, { status: access.status });

    const feat = await requirePlanFeature(access.admin, access.companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const body = await req.json().catch(() => ({}));
    const agentId = String(body?.agent_id ?? "").trim();
    if (!agentId) return NextResponse.json({ error: "agent_id obrigatório" }, { status: 400 });

    const admin = createAdminClient();
    const rotated = await rotatePrintAgentApiKey(admin, {
        agentId,
        companyId: access.companyId,
    });
    if (!rotated.ok) {
        const status = rotated.error === "agent_not_found_or_inactive" ? 404 : 500;
        return NextResponse.json({ error: rotated.error }, { status });
    }

    return NextResponse.json({
        ok: true,
        agent_id: agentId,
        api_key: rotated.apiKey,
        api_key_prefix: rotated.prefix,
    });
}

export async function DELETE(req: Request) {
    const access = await requireCompanyAccess({
        allowedRoles: ["owner", "admin"],
        mutating: true,
    });
    if (!access.ok) return new NextResponse(access.error, { status: access.status });

    const feat = await requirePlanFeature(access.admin, access.companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const { agent_id } = await req.json().catch(() => ({}));
    if (!agent_id) return NextResponse.json({ error: "agent_id obrigatório" }, { status: 400 });

    const admin = createAdminClient();
    const revoked = await revokePrintAgentApiKey(admin, {
        agentId: String(agent_id),
        companyId: access.companyId,
    });
    if (!revoked.ok) {
        const status = revoked.error === "agent_not_found" ? 404 : 500;
        return NextResponse.json({ error: revoked.error }, { status });
    }
    return NextResponse.json({ ok: true });
}
