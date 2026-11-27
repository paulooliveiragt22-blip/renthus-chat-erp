export type AttendanceMode = "delivery" | "service";

export type ServicePreset = "horario" | "servico" | "consulta_caso" | "balcao";

export type CaseStage = "aberto" | "em_andamento" | "concluido" | "perdido";

export type AppointmentStatus = "confirmed" | "cancelled";

export type AppointmentSource = "whatsapp_button" | "admin";

export type ServiceActor = "whatsapp" | "admin";

export type ServiceResultCode =
    | "ok"
    | "idempotent_replay"
    | "not_service"
    | "agenda_off"
    | "cases_off"
    | "invalid_preset"
    | "invalid_source"
    | "invalid_idempotency"
    | "invalid_title"
    | "invalid_stage"
    | "offering_invalid"
    | "offer_expired"
    | "outside_hours"
    | "no_hours"
    | "cross_tenant"
    | "phone_mismatch"
    | "case_invalid"
    | "case_closed"
    | "appointment_closed"
    | "cap_reached"
    | "slot_taken"
    | "flag_off"
    | "calendar_unavailable";

export type ServiceFlags = {
    agendaEnabled: boolean;
    casesEnabled: boolean;
};

export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
    aberto: "Aberto",
    em_andamento: "Em andamento",
    concluido: "Concluído",
    perdido: "Perdido",
};

export const SERVICE_TOOL_NAMES = [
    "list_offerings",
    "list_free_slots",
    "propose_slot",
    "list_appointments",
    "cancel_appointment",
    "reschedule_appointment",
    "list_open_cases",
    "propose_case",
    "request_human",
    "save_visitor",
    "respond_to_customer",
] as const;

export type ServiceToolName = (typeof SERVICE_TOOL_NAMES)[number];

export type ServiceButtonId = "svc_confirm_slot" | "svc_confirm_case";

export type TurnWrites = {
    booked: boolean;
    cancelled: boolean;
    rescheduled: boolean;
    caseOpened: boolean;
    slotProposed: boolean;
    caseProposed: boolean;
    humanRequested: boolean;
};

export function emptyTurnWrites(): TurnWrites {
    return {
        booked: false,
        cancelled: false,
        rescheduled: false,
        caseOpened: false,
        slotProposed: false,
        caseProposed: false,
        humanRequested: false,
    };
}

export type ServiceProfileView = {
    preset: ServicePreset;
    contextText: string;
    agendaEnabled: boolean;
    casesEnabled: boolean;
    cancelEnabled: boolean;
    rescheduleEnabled: boolean;
    timeZone: string;
    labels: Record<CaseStage, string>;
};

export type ServiceOfferingView = {
    id: string;
    name: string;
    description: string | null;
    durationMin: number | null;
    priceCents: number | null;
    linkUrl: string | null;
    linkLabel: string | null;
};

export type ServiceAppointmentView = {
    id: string;
    offeringName: string;
    startsAt: string;
};

export type ServiceCaseView = {
    id: string;
    title: string;
    stage: CaseStage;
    label: string;
};

export type ServiceCommandResult = {
    ok: boolean;
    code: ServiceResultCode;
    appointmentId?: string;
    caseId?: string;
    offerId?: string;
    offeringName?: string;
    startsAt?: string;
    title?: string;
    timeZone?: string;
};

const RESULT_CODES: ReadonlySet<string> = new Set<ServiceResultCode>([
    "ok",
    "idempotent_replay",
    "not_service",
    "agenda_off",
    "cases_off",
    "invalid_preset",
    "invalid_source",
    "invalid_idempotency",
    "invalid_title",
    "invalid_stage",
    "offering_invalid",
    "offer_expired",
    "outside_hours",
    "no_hours",
    "cross_tenant",
    "phone_mismatch",
    "case_invalid",
    "case_closed",
    "appointment_closed",
    "cap_reached",
    "slot_taken",
    "flag_off",
    "calendar_unavailable",
]);

export function isServiceResultCode(value: unknown): value is ServiceResultCode {
    return typeof value === "string" && RESULT_CODES.has(value);
}
