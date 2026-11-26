import type { ServiceProfileView, ServiceToolName } from "./types";

const ALWAYS: readonly ServiceToolName[] = [
    "list_offerings",
    "request_human",
    "respond_to_customer",
];

const SITE: readonly ServiceToolName[] = [...ALWAYS, "save_visitor"];

export function toolsForTurn(profile: ServiceProfileView, channel: string | undefined): ServiceToolName[] {
    if (channel === "site") return [...SITE];
    return toolsForProfile(profile);
}

export function toolsForProfile(profile: ServiceProfileView): ServiceToolName[] {
    const names: ServiceToolName[] = [...ALWAYS];
    if (profile.agendaEnabled) {
        names.push("list_free_slots", "propose_slot", "list_appointments");
        if (profile.cancelEnabled) names.push("cancel_appointment");
        if (profile.rescheduleEnabled) names.push("reschedule_appointment");
    }
    if (profile.casesEnabled) {
        names.push("list_open_cases", "propose_case");
    }
    return names;
}
