import type { SupabaseClient } from "@supabase/supabase-js";
import { isServicePreset } from "@/src/service/domain/preset";
import {
    CASE_STAGE_LABELS,
    isServiceResultCode,
    type CaseStage,
    type ServiceAppointmentView,
    type ServiceCaseView,
    type ServiceCommandResult,
    type ServiceOfferingView,
    type ServiceProfileView,
} from "@/src/service/domain/types";
import type { ServiceDataPort, ServiceSlotList } from "@/src/service/ports/serviceTurnPorts";

const STAGES: readonly CaseStage[] = ["aberto", "em_andamento", "concluido", "perdido"];

function isStage(value: unknown): value is CaseStage {
    return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
}

function mapCommand(raw: unknown): ServiceCommandResult {
    const row = asRecord(raw);
    if (!row) return { ok: false, code: "offering_invalid" };
    const code = isServiceResultCode(row.code) ? row.code : "offering_invalid";
    const ok = row.ok === true && (code === "ok" || code === "idempotent_replay");
    return {
        ok,
        code: ok ? code : code === "ok" ? "offering_invalid" : code,
        appointmentId: typeof row.appointment_id === "string" ? row.appointment_id : undefined,
        caseId: typeof row.case_id === "string" ? row.case_id : undefined,
        offerId: typeof row.offer_id === "string" ? row.offer_id : undefined,
        offeringName: typeof row.offering_name === "string" ? row.offering_name : undefined,
        startsAt: typeof row.starts_at === "string" ? row.starts_at : undefined,
        title: typeof row.title === "string" ? row.title : undefined,
        timeZone: typeof row.time_zone === "string" ? row.time_zone : undefined,
    };
}

function mapRows(raw: unknown): Record<string, unknown>[] {
    const row = asRecord(raw);
    const rows = row?.rows;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
    });
}

async function callRpc(
    admin: SupabaseClient,
    fn: string,
    args: Record<string, unknown>
): Promise<unknown> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) {
        throw new Error(`service_rpc:${fn}:${error.message}`);
    }
    return data;
}

export function createServiceDataPort(admin: SupabaseClient): ServiceDataPort {
    return {
        async loadProfile(companyId) {
            const raw = await callRpc(admin, "rpc_service_load_profile", { p_company_id: companyId });
            const row = asRecord(raw);
            if (!row || row.ok !== true || typeof row.preset !== "string" || !isServicePreset(row.preset)) {
                return null;
            }
            const labels = asRecord(row.labels);
            return {
                preset: row.preset,
                contextText: typeof row.context_text === "string" ? row.context_text : "",
                agendaEnabled: row.agenda_enabled === true,
                casesEnabled: row.cases_enabled === true,
                cancelEnabled: row.whatsapp_cancel_enabled === true,
                rescheduleEnabled: row.whatsapp_reschedule_enabled === true,
                timeZone: typeof row.time_zone === "string" ? row.time_zone : "America/Cuiaba",
                labels: {
                    aberto: labelOf(labels, "aberto"),
                    em_andamento: labelOf(labels, "em_andamento"),
                    concluido: labelOf(labels, "concluido"),
                    perdido: labelOf(labels, "perdido"),
                },
            } satisfies ServiceProfileView;
        },
        async listOfferings(companyId) {
            const raw = await callRpc(admin, "rpc_service_list_offerings", { p_company_id: companyId });
            return mapRows(raw).flatMap(mapOffering);
        },
        async listFreeSlots(companyId, offeringId, day) {
            const raw = await callRpc(admin, "rpc_service_list_free_slots", {
                p_company_id: companyId,
                p_offering_id: offeringId,
                p_day: day,
            });
            const command = mapCommand(raw);
            const row = asRecord(raw);
            const slots = Array.isArray(row?.slots)
                ? row.slots.filter((slot): slot is string => typeof slot === "string")
                : [];
            const listed: ServiceSlotList = { ...command, slots: command.ok ? slots : [] };
            return listed;
        },
        async proposeSlot(companyId, threadId, offeringId, startsAt) {
            return mapCommand(
                await callRpc(admin, "rpc_service_propose_slot", {
                    p_company_id: companyId,
                    p_thread_id: threadId,
                    p_offering_id: offeringId,
                    p_starts_at: startsAt,
                })
            );
        },
        async listAppointments(companyId, threadId) {
            const raw = await callRpc(admin, "rpc_service_list_thread_appointments", {
                p_company_id: companyId,
                p_thread_id: threadId,
            });
            return mapRows(raw).flatMap(mapAppointment);
        },
        async cancelAppointment(companyId, threadId, appointmentId) {
            return mapCommand(
                await callRpc(admin, "rpc_service_cancel_appointment", {
                    p_company_id: companyId,
                    p_appointment_id: appointmentId,
                    p_actor: "whatsapp",
                    p_thread_id: threadId,
                })
            );
        },
        async rescheduleAppointment(companyId, threadId, appointmentId, startsAt, idempotencyKey) {
            return mapCommand(
                await callRpc(admin, "rpc_service_reschedule_appointment", {
                    p_company_id: companyId,
                    p_appointment_id: appointmentId,
                    p_starts_at: startsAt,
                    p_idempotency_key: idempotencyKey,
                    p_actor: "whatsapp",
                    p_thread_id: threadId,
                })
            );
        },
        async listOpenCases(companyId, threadId) {
            const raw = await callRpc(admin, "rpc_service_list_thread_cases", {
                p_company_id: companyId,
                p_thread_id: threadId,
            });
            return mapRows(raw).flatMap(mapCase);
        },
        async proposeCase(companyId, threadId, title, summary) {
            return mapCommand(
                await callRpc(admin, "rpc_service_propose_case", {
                    p_company_id: companyId,
                    p_thread_id: threadId,
                    p_title: title,
                    p_summary: summary,
                })
            );
        },
        async confirmOpenSlot(companyId, threadId, idempotencyKey, customerName) {
            return mapCommand(
                await callRpc(admin, "rpc_service_confirm_open_slot", {
                    p_company_id: companyId,
                    p_thread_id: threadId,
                    p_idempotency_key: idempotencyKey,
                    p_customer_name: customerName,
                })
            );
        },
        async confirmOpenCase(companyId, threadId, idempotencyKey) {
            return mapCommand(
                await callRpc(admin, "rpc_service_confirm_open_case", {
                    p_company_id: companyId,
                    p_thread_id: threadId,
                    p_idempotency_key: idempotencyKey,
                })
            );
        },
    };
}

function labelOf(labels: Record<string, unknown> | null, stage: CaseStage): string {
    const value = labels?.[stage];
    return typeof value === "string" && value.trim().length > 0 ? value : CASE_STAGE_LABELS[stage];
}

function mapOffering(row: Record<string, unknown>): ServiceOfferingView[] {
    if (typeof row.id !== "string" || typeof row.name !== "string") return [];
    return [
        {
            id: row.id,
            name: row.name,
            description: typeof row.description === "string" ? row.description : null,
            durationMin: typeof row.duration_min === "number" ? row.duration_min : null,
            priceCents: typeof row.price_cents === "number" ? row.price_cents : null,
        },
    ];
}

function mapAppointment(row: Record<string, unknown>): ServiceAppointmentView[] {
    if (typeof row.id !== "string" || typeof row.offering_name !== "string" || typeof row.starts_at !== "string") {
        return [];
    }
    return [{ id: row.id, offeringName: row.offering_name, startsAt: row.starts_at }];
}

function mapCase(row: Record<string, unknown>): ServiceCaseView[] {
    if (typeof row.id !== "string" || typeof row.title !== "string" || !isStage(row.stage)) return [];
    return [
        {
            id: row.id,
            title: row.title,
            stage: row.stage,
            label: typeof row.label === "string" ? row.label : CASE_STAGE_LABELS[row.stage],
        },
    ];
}
