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
