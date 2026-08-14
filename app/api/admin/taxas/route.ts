import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    deactivateServiceFeeDefinition,
    listServiceFeeDefinitions,
    upsertServiceFeeDefinition,
} from "@/src/taxas/application/serviceFees";
import type {
    ServiceFeeCalcMode,
    ServiceFeeSystemKey,
    UpsertServiceFeePayload,
} from "@/src/taxas/domain/types";

export const runtime = "nodejs";

const MODES = new Set(["fixed", "percent"]);
const KEYS = new Set(["delivery", "service", "other"]);

function parsePayload(body: Record<string, unknown>): UpsertServiceFeePayload | { error: string } {
    const name = String(body.name ?? "").trim();
    if (!name) return { error: "name_required" };
    const calc_mode = String(body.calc_mode ?? "fixed") as ServiceFeeCalcMode;
    if (!MODES.has(calc_mode)) return { error: "invalid_calc_mode" };
    const value = Number.parseFloat(String(body.value ?? "").replaceAll(",", "."));
    if (!Number.isFinite(value) || value < 0) return { error: "invalid_value" };
    if (calc_mode === "percent" && value > 100) return { error: "percent_out_of_range" };

    let system_key: ServiceFeeSystemKey | null | undefined;
    if (body.system_key === null || body.system_key === "") {
        system_key = null;
    } else if (body.system_key !== undefined) {
        const k = String(body.system_key);
        if (!KEYS.has(k)) return { error: "invalid_system_key" };
        system_key = k as ServiceFeeSystemKey;
    }

    const payload: UpsertServiceFeePayload = {
        name,
        calc_mode,
        value,
        is_active: body.is_active === undefined ? true : Boolean(body.is_active),
        sort_order:
            body.sort_order === undefined
                ? 100
                : Number.parseInt(String(body.sort_order), 10) || 100,
    };
    if (body.id) payload.id = String(body.id);
    if (body.slug) payload.slug = String(body.slug).trim();
    if (system_key !== undefined) payload.system_key = system_key;
    return payload;
}

/** GET /api/admin/taxas — lista definições da empresa. */
export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const url = new URL(req.url);
    const activeOnly = url.searchParams.get("active") === "1";

    try {
        const definitions = await listServiceFeeDefinitions(
            ctx.admin,
            ctx.companyId,
            activeOnly
        );
        return NextResponse.json({ definitions });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "list_failed" },
            { status: 500 }
        );
    }
}

/** POST /api/admin/taxas — cria definição. */
export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parsePayload(body);
    if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    try {
        const id = await upsertServiceFeeDefinition(ctx.admin, ctx.companyId, parsed);
        return NextResponse.json({ ok: true, id });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "upsert_failed" },
            { status: 500 }
        );
    }
}

/** PATCH /api/admin/taxas — atualiza definição (body.id obrigatório). */
export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body.id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    const parsed = parsePayload(body);
    if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    try {
        const id = await upsertServiceFeeDefinition(ctx.admin, ctx.companyId, parsed);
        return NextResponse.json({ ok: true, id });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "upsert_failed" },
            { status: 500 }
        );
    }
}

/** DELETE /api/admin/taxas?id= — desativa definição. */
export async function DELETE(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    try {
        await deactivateServiceFeeDefinition(ctx.admin, ctx.companyId, id);
        return NextResponse.json({ ok: true });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "delete_failed" },
            { status: 500 }
        );
    }
}
