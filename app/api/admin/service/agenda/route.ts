import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { adminBookSchema, cancelAppointmentSchema, rescheduleAppointmentSchema } from "@/src/service/http/schemas";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const result = await callServiceRpc(ctx.admin, "rpc_service_list_company_appointments", {
        p_company_id: ctx.companyId,
    });
    return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
    const ctx = await requireCapability("settings.company", "any", { mutating: true });
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const body: unknown = await req.json().catch(() => null);
    const action = body && typeof body === "object" && "action" in body ? body.action : null;

    if (action === "book") {
        const parsed = adminBookSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_book" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_admin_book", {
            p_company_id: ctx.companyId,
            p_idempotency_key: parsed.data.idempotencyKey,
            p_offering_id: parsed.data.offeringId,
            p_starts_at: parsed.data.startsAt,
            p_phone_e164: parsed.data.phoneE164,
            p_customer_name: parsed.data.customerName ?? null,
            p_case_id: parsed.data.caseId ?? null,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "cancel") {
        const parsed = cancelAppointmentSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_cancel" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_cancel_appointment", {
            p_company_id: ctx.companyId,
            p_appointment_id: parsed.data.appointmentId,
            p_actor: "admin",
            p_thread_id: null,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "reschedule") {
        const parsed = rescheduleAppointmentSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_reschedule" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_reschedule_appointment", {
            p_company_id: ctx.companyId,
            p_appointment_id: parsed.data.appointmentId,
            p_starts_at: parsed.data.startsAt,
            p_idempotency_key: parsed.data.idempotencyKey,
            p_actor: "admin",
            p_thread_id: null,
        });
        return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
