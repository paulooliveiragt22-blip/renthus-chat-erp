import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { createGoogleCalendarPort } from "@/src/service/adapters/google/googleCalendarPort";
import { adminBookSchema, cancelAppointmentSchema, rescheduleAppointmentSchema } from "@/src/service/http/schemas";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

function commandId(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const id = (body as { appointment_id?: unknown }).appointment_id;
    return typeof id === "string" ? id : null;
}

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

    const calendar = createGoogleCalendarPort(ctx.admin);

    if (action === "book") {
        const parsed = adminBookSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_book" }, { status: 400 });
        const gate = await calendar.gateOffering(ctx.companyId, parsed.data.offeringId, parsed.data.startsAt);
        if (gate === "busy") return NextResponse.json({ ok: false, code: "slot_taken" }, { status: 400 });
        if (gate === "unavailable") return NextResponse.json({ ok: false, code: "calendar_unavailable" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_admin_book", {
            p_company_id: ctx.companyId,
            p_idempotency_key: parsed.data.idempotencyKey,
            p_offering_id: parsed.data.offeringId,
            p_starts_at: parsed.data.startsAt,
            p_phone_e164: parsed.data.phoneE164,
            p_customer_name: parsed.data.customerName ?? null,
            p_case_id: parsed.data.caseId ?? null,
        });
        const appointmentId = commandId(result.body);
        if (result.status === 200 && appointmentId) {
            await calendar.mirrorBooked(ctx.companyId, appointmentId);
        }
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
        if (result.status === 200) await calendar.mirrorCancelled(ctx.companyId, parsed.data.appointmentId);
        return NextResponse.json(result.body, { status: result.status });
    }

    if (action === "reschedule") {
        const parsed = rescheduleAppointmentSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "invalid_reschedule" }, { status: 400 });
        const gate = await calendar.gateMoved(ctx.companyId, parsed.data.appointmentId, parsed.data.startsAt);
        if (gate === "busy") return NextResponse.json({ ok: false, code: "slot_taken" }, { status: 400 });
        if (gate === "unavailable") return NextResponse.json({ ok: false, code: "calendar_unavailable" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_reschedule_appointment", {
            p_company_id: ctx.companyId,
            p_appointment_id: parsed.data.appointmentId,
            p_starts_at: parsed.data.startsAt,
            p_idempotency_key: parsed.data.idempotencyKey,
            p_actor: "admin",
            p_thread_id: null,
        });
        const nextId = commandId(result.body);
        if (result.status === 200 && nextId) {
            await calendar.mirrorMoved(ctx.companyId, parsed.data.appointmentId, nextId);
        }
        return NextResponse.json(result.body, { status: result.status });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
