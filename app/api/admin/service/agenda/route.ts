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

export async function GET(req: Request) {
    const ctx = await requireCapability("settings.company");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
        const result = await callServiceRpc(ctx.admin, "rpc_service_list_company_appointments", {
            p_company_id: ctx.companyId,
        });
        return NextResponse.json(result.body, { status: result.status });
    }
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
        return NextResponse.json({ ok: false, code: "google_invalid" }, { status: 400 });
    }
    const result = await callServiceRpc(ctx.admin, "rpc_service_list_appointments_range", {
        p_company_id: ctx.companyId,
        p_from: new Date(fromMs).toISOString(),
        p_to: new Date(toMs).toISOString(),
    });
    const body = result.body && typeof result.body === "object" ? (result.body as { rows?: unknown; ok?: unknown }) : {};
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const ownIds = new Set(
        rows.flatMap((row) => {
            if (!row || typeof row !== "object") return [];
            const id = (row as { google_event_id?: unknown }).google_event_id;
            return typeof id === "string" && id ? [id] : [];
        })
    );
    const yearSpan = toMs - fromMs > 62 * 24 * 60 * 60 * 1000;
    const google = yearSpan
        ? { connected: false, unavailable: false, events: [] as { id: string }[] }
        : await createGoogleCalendarPort(ctx.admin).listWindow(ctx.companyId, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
    return NextResponse.json(
        {
            ...body,
            google: {
                connected: google.connected,
                unavailable: google.unavailable,
                events: google.events.filter((event) => !ownIds.has(event.id)),
            },
        },
        { status: result.status }
    );
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
        const startsMs = Date.parse(parsed.data.startsAt);
        const gate = parsed.data.offeringId
            ? await calendar.gateOffering(ctx.companyId, parsed.data.offeringId, parsed.data.startsAt)
            : Number.isFinite(startsMs)
              ? await calendar.gateSpan(
                    ctx.companyId,
                    new Date(startsMs).toISOString(),
                    new Date(startsMs + parsed.data.durationMin * 60_000).toISOString()
                )
              : "off";
        if (gate === "busy") return NextResponse.json({ ok: false, code: "slot_taken" }, { status: 400 });
        if (gate === "unavailable") return NextResponse.json({ ok: false, code: "calendar_unavailable" }, { status: 400 });
        const result = await callServiceRpc(ctx.admin, "rpc_service_admin_book", {
            p_company_id: ctx.companyId,
            p_idempotency_key: parsed.data.idempotencyKey,
            p_offering_id: parsed.data.offeringId ?? null,
            p_starts_at: parsed.data.startsAt,
            p_phone_e164: parsed.data.phoneE164,
            p_customer_name: parsed.data.customerName ?? null,
            p_case_id: parsed.data.caseId ?? null,
            p_label: parsed.data.label ?? null,
            p_duration_min: parsed.data.durationMin,
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
