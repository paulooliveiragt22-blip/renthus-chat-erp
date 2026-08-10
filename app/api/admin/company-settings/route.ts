import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

const VALID_LLM_PROVIDERS = new Set(["anthropic", "openai"]);

/**
 * Piloto controlado do provider OpenAI (ver docs/PLANO_MULTI_PROVIDER_IA.md, Fase 8): sem dado
 * real de qualidade do GPT-5 mini no prompt específico ainda, então só empresas nesta allowlist
 * podem setar `llm_provider="openai"`. `anthropic`/`null` sempre permitidos (comportamento atual,
 * zero risco novo). Reversível: remover este check libera o provider pra qualquer empresa.
 */
function isCompanyAllowedOpenAiProvider(companyId: string): boolean {
    const raw = process.env.OPENAI_PROVIDER_PILOT_COMPANY_IDS?.trim();
    if (!raw) return false;
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(companyId);
}

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("company_settings")
        .select("require_order_approval, auto_print_orders, llm_provider")
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
        settings: data ?? null,
        openaiProviderAllowed: isCompanyAllowedOpenAiProvider(companyId),
    });
}

type LlmProviderPatchResult =
    | { ok: true; value: string | null }
    | { ok: false; status: number; error: string };

/**
 * Gate de permissão específico: motor de IA é decisão de custo/qualidade — só owner/admin, mesmo
 * que a rota em geral permita staff nos outros campos. Extraída pra manter `PATCH` simples.
 */
function validateLlmProviderPatch(
    rawValue: string | null,
    role: string,
    companyId: string
): LlmProviderPatchResult {
    if (role !== "owner" && role !== "admin") {
        return { ok: false, status: 403, error: "Apenas owner/admin podem alterar o motor de IA" };
    }
    const value = rawValue === null ? null : rawValue.trim().toLowerCase();
    if (value !== null && !VALID_LLM_PROVIDERS.has(value)) {
        return { ok: false, status: 400, error: "llm_provider inválido" };
    }
    if (value === "openai" && !isCompanyAllowedOpenAiProvider(companyId)) {
        return { ok: false, status: 403, error: "Esta empresa ainda não está no piloto do provider OpenAI" };
    }
    return { ok: true, value };
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        require_order_approval?: boolean;
        auto_print_orders?: boolean;
        llm_provider?: string | null;
    };

    const patch: Record<string, unknown> = { company_id: companyId };
    if (body.require_order_approval !== undefined) patch.require_order_approval = Boolean(body.require_order_approval);
    if (body.auto_print_orders !== undefined) patch.auto_print_orders = Boolean(body.auto_print_orders);

    if (body.llm_provider !== undefined) {
        const result = validateLlmProviderPatch(body.llm_provider, role, companyId);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        patch.llm_provider = result.value;
    }

    if (Object.keys(patch).length <= 1) {
        return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
    }

    const { error } = await admin
        .from("company_settings")
        .upsert(patch, { onConflict: "company_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
