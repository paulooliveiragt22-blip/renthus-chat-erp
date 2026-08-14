export const FINANCE_ORIGINS = [
    "pdv",
    "chatbot",
    "web_menu",
    "ui_order",
    "ai_chat",
    "table_service",
    "marketplace",
    "manual",
] as const;

export type FinanceOrigin = (typeof FINANCE_ORIGINS)[number];

/** Rótulos da UI — `ai_chat` nunca cai em PDV/balcão. */
export const ORIGIN_LABELS: Record<FinanceOrigin, string> = {
    pdv: "PDV",
    chatbot: "Chat",
    web_menu: "Web",
    ui_order: "UI",
    ai_chat: "IA",
    table_service: "Mesa",
    marketplace: "Marketplace",
    manual: "Manual",
};

const ORIGIN_SET = new Set<string>(FINANCE_ORIGINS);

export function normalizeFinanceOrigin(raw: string | null | undefined): FinanceOrigin {
    const v = String(raw ?? "").trim().toLowerCase();
    if (v === "ai_chat" || v === "ia") return "ai_chat";
    if (v === "chatbot" || v.startsWith("flow_")) return "chatbot";
    if (v === "web_menu" || v === "web") return "web_menu";
    if (v === "ui" || v === "ui_order" || v === "admin") return "ui_order";
    if (v === "table_service" || v === "mesa") return "table_service";
    if (v.startsWith("marketplace")) return "marketplace";
    if (v === "manual") return "manual";
    if (v === "balcao" || v === "pdv" || v === "pdv_direct" || v === "") return "pdv";
    if (ORIGIN_SET.has(v)) return v as FinanceOrigin;
    return "manual";
}
