import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    DELIVERY_DESCRIPTION_MAX,
    normalizeHhMm,
    normalizeTimezone,
    sanitizeDeliveryDescription,
} from "@/lib/delivery/hours";

export const runtime = "nodejs";

const VALID_LLM_PROVIDERS = new Set(["anthropic", "openai"]);

const SETTINGS_SELECT =
    "require_order_approval, auto_print_orders, llm_provider, open_time, close_time, timezone, delivery_description";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("company_settings")
        .select(SETTINGS_SELECT)
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ settings: data ?? null });
}

type LlmProviderPatchResult =
    | { ok: true; value: string | null }
    | { ok: false; status: number; error: string };

/**
 * Gate de permissão específico: motor de IA é decisão de custo/qualidade — só owner/admin, mesmo
 * que a rota em geral permita staff nos outros campos. Extraída pra manter `PATCH` simples.
 * Sem allowlist de piloto: qualquer empresa pode escolher `anthropic` ou `openai` (ver
 * docs/PLANO_MULTI_PROVIDER_IA.md, Fase 8 — decisão revertida depois de validar o desenho).
 */
function validateLlmProviderPatch(rawValue: string | null, role: string): LlmProviderPatchResult {
    if (role !== "owner" && role !== "admin") {
        return { ok: false, status: 403, error: "Apenas owner/admin podem alterar o motor de IA" };
    }
    const value = rawValue === null ? null : rawValue.trim().toLowerCase();
    if (value !== null && !VALID_LLM_PROVIDERS.has(value)) {
        return { ok: false, status: 400, error: "llm_provider inválido" };
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
        open_time?: string | null;
        close_time?: string | null;
        timezone?: string | null;
        delivery_description?: string | null;
    };

    const patch: Record<string, unknown> = { company_id: companyId };
    if (body.require_order_approval !== undefined) patch.require_order_approval = Boolean(body.require_order_approval);
    if (body.auto_print_orders !== undefined) patch.auto_print_orders = Boolean(body.auto_print_orders);

    if (body.llm_provider !== undefined) {
        const result = validateLlmProviderPatch(body.llm_provider, role);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        patch.llm_provider = result.value;
    }

    if (body.open_time !== undefined) {
        if (body.open_time === null || String(body.open_time).trim() === "") {
            patch.open_time = null;
        } else {
            const n = normalizeHhMm(body.open_time);
            if (!n) return NextResponse.json({ error: "open_time inválido (use HH:MM)" }, { status: 400 });
            patch.open_time = n;
        }
    }
    if (body.close_time !== undefined) {
        if (body.close_time === null || String(body.close_time).trim() === "") {
            patch.close_time = null;
        } else {
            const n = normalizeHhMm(body.close_time);
            if (!n) return NextResponse.json({ error: "close_time inválido (use HH:MM)" }, { status: 400 });
            patch.close_time = n;
        }
    }
    if (body.timezone !== undefined) {
        patch.timezone = normalizeTimezone(body.timezone);
    }
    if (body.delivery_description !== undefined) {
        const desc = sanitizeDeliveryDescription(body.delivery_description);
        if (
            body.delivery_description != null &&
            String(body.delivery_description).trim().length > DELIVERY_DESCRIPTION_MAX
        ) {
            return NextResponse.json(
                { error: `delivery_description máximo ${DELIVERY_DESCRIPTION_MAX} caracteres` },
                { status: 400 }
            );
        }
        patch.delivery_description = desc;
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
