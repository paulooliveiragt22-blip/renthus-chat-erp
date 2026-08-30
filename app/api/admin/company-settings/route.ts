import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import {
    DELIVERY_DESCRIPTION_MAX,
    MAX_OPENING_PERIODS,
    normalizeOpeningPeriods,
    normalizeTimezone,
    sanitizeDeliveryDescription,
} from "@/lib/delivery/hours";
import { normalizePrintCopyTypes } from "@/lib/print/copyTypes";

export const runtime = "nodejs";

const VALID_LLM_PROVIDERS = new Set(["anthropic", "openai", "ollama", "groq"]);

const SETTINGS_SELECT =
    "require_order_approval, auto_print_orders, llm_provider, open_time, close_time, opening_periods, timezone, delivery_description, print_auto_copies";

export async function GET() {
    const ctx = await requireCapability("settings.company");
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
 * Sem allowlist de piloto: qualquer empresa pode escolher `anthropic`, `openai` ou `ollama`
 * (local via Ollama — ver `modelProvider.ts`). Ollama só funciona se a máquina que serve a
 * rota tiver Ollama rodando; em produção (Vercel) normalmente não vai estar disponível.
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
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, role } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        require_order_approval?: boolean;
        auto_print_orders?: boolean;
        llm_provider?: string | null;
        open_time?: string | null;
        close_time?: string | null;
        opening_periods?: unknown;
        timezone?: string | null;
        delivery_description?: string | null;
        print_auto_copies?: unknown;
    };

    const patch: Record<string, unknown> = { company_id: companyId };
    if (body.require_order_approval !== undefined) patch.require_order_approval = Boolean(body.require_order_approval);
    if (body.auto_print_orders !== undefined) patch.auto_print_orders = Boolean(body.auto_print_orders);
    if (body.print_auto_copies !== undefined) {
        patch.print_auto_copies = normalizePrintCopyTypes(body.print_auto_copies);
    }

    if (body.llm_provider !== undefined) {
        const result = validateLlmProviderPatch(body.llm_provider, role);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
        patch.llm_provider = result.value;
    }

    if (body.opening_periods !== undefined) {
        const periods = normalizeOpeningPeriods(body.opening_periods);
        if (Array.isArray(body.opening_periods) && body.opening_periods.length > MAX_OPENING_PERIODS) {
            return NextResponse.json(
                { error: `Máximo ${MAX_OPENING_PERIODS} turnos de atendimento` },
                { status: 400 }
            );
        }
        patch.opening_periods = periods.map((p) => ({ open: p.openTime, close: p.closeTime }));
        patch.open_time = periods[0]?.openTime ?? null;
        patch.close_time = periods[0]?.closeTime ?? null;
    } else if (body.open_time !== undefined || body.close_time !== undefined) {
        return NextResponse.json(
            { error: "Envie opening_periods (até 2 turnos). open_time/close_time isolados não são aceitos." },
            { status: 400 }
        );
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
