export type ServiceButton = "slot" | "case";

export function serviceButton(text: string): ServiceButton | null {
    const value = text.trim();
    if (value === "svc_confirm_slot") return "slot";
    if (value === "svc_confirm_case") return "case";
    return null;
}
