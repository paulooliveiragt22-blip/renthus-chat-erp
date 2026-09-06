import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { checkRateLimit, RATE_LIMIT_WINDOW_MS } from "@/lib/security/rateLimit";
import {
    maskEmailForImpersonation,
    maskPhoneForImpersonation,
} from "@/lib/platform/impersonation";

export const runtime = "nodejs";

const LIST_SELECT =
    "id,company_id,name,phone,phone_e164,neighborhood,created_at";

const EXPORT_SELECT =
    "id,company_id,name,phone,phone_e164,address,neighborhood,cpf_cnpj,tipo_pessoa,limite_credito,saldo_devedor,origem,email,notes,is_adult,created_at";

const LIST_LIMIT_DEFAULT = 100;
const LIST_LIMIT_MAX = 100;
const EXPORT_LIMIT_DEFAULT = 500;
const EXPORT_LIMIT_MAX = 500;
const EXPORT_RL_PER_MIN = 10;

function parseLimit(raw: string | null, fallback: number, max: number): number {
    const n = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(n, max);
}

function redactCustomerRow(
    row: Record<string, unknown>,
    impersonating: boolean
): Record<string, unknown> {
    if (!impersonating) return row;
    return {
        ...row,
        phone: maskPhoneForImpersonation(
            typeof row.phone === "string" ? row.phone : null
        ),
        phone_e164: maskPhoneForImpersonation(
            typeof row.phone_e164 === "string" ? row.phone_e164 : null
        ),
        email: maskEmailForImpersonation(
            typeof row.email === "string" ? row.email : null
        ),
        cpf_cnpj: row.cpf_cnpj ? "***" : null,
        address: row.address ? "[redacted]" : null,
        notes: null,
    };
}

export async function GET(req: NextRequest) {
    const wantsExport = req.nextUrl.searchParams.get("export") === "1";

    if (wantsExport) {
        const ctx = await requireCapability("customers.export");
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const rl = checkRateLimit(
            `customers_export:${ctx.companyId}:${ctx.userId}`,
            EXPORT_RL_PER_MIN,
            RATE_LIMIT_WINDOW_MS
        );
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "rate_limit_exceeded" },
                { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
            );
        }

        const limit = parseLimit(
            req.nextUrl.searchParams.get("limit"),
            EXPORT_LIMIT_DEFAULT,
            EXPORT_LIMIT_MAX
        );
        const { admin, companyId } = ctx;
        const { data, error } = await admin
            .from("customers")
            .select(EXPORT_SELECT)
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const customers = (data ?? []).map((row) =>
            redactCustomerRow(row as Record<string, unknown>, ctx.impersonating)
        );
        return NextResponse.json({
            mode: "export",
            limit,
            customers,
            pii_redacted: ctx.impersonating,
        });
    }

    const ctx = await requireCapability("customers.read");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const limit = parseLimit(
        req.nextUrl.searchParams.get("limit"),
        LIST_LIMIT_DEFAULT,
        LIST_LIMIT_MAX
    );

    const { data, error } = await admin
        .from("customers")
        .select(LIST_SELECT)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const customers = (data ?? []).map((row) =>
        redactCustomerRow(row as Record<string, unknown>, ctx.impersonating)
    );
    return NextResponse.json({
        mode: "list",
        limit,
        customers,
        pii_redacted: ctx.impersonating,
    });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("customers.write", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    if (!name || !phone) return NextResponse.json({ error: "name_phone_required" }, { status: 400 });

    const { data: newId, error } = await admin.rpc("rpc_upsert_customer_with_primary_address", {
        p_company_id: companyId,
        p_payload: {
            customer: {
                origem: "admin",
                name,
                phone,
                email: String(body.email ?? "").trim() || null,
                cpf_cnpj: String(body.cpf_cnpj ?? "").trim() || null,
                tipo_pessoa: String(body.tipo_pessoa ?? "PF"),
                limite_credito: Number.parseFloat(String(body.limite_credito ?? "0")) || 0,
                notes: String(body.notes ?? "").trim() || null,
            },
        },
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data, error: selErr } = await admin
        .from("customers")
        .select(EXPORT_SELECT)
        .eq("id", newId as string)
        .eq("company_id", companyId)
        .single();
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
    return NextResponse.json({ customer: data });
}

export async function PATCH(req: Request) {
    const ctx = await requireCapability("customers.write", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin.rpc("rpc_upsert_customer_with_primary_address", {
        p_company_id: companyId,
        p_payload: {
            customer: {
                id,
                name: String(body.name ?? "").trim(),
                phone: String(body.phone ?? "").trim(),
                email: String(body.email ?? "").trim() || null,
                cpf_cnpj: String(body.cpf_cnpj ?? "").trim() || null,
                tipo_pessoa: String(body.tipo_pessoa ?? "PF"),
                limite_credito: Number.parseFloat(String(body.limite_credito ?? "0")) || 0,
                notes: String(body.notes ?? "").trim() || null,
            },
        },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
    const ctx = await requireCapability("customers.write", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin.from("customers").delete().eq("id", id).eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
