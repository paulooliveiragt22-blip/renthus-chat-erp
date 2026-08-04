/**
 * Catálogo comercial canônico — Essencial / Pro / Market.
 * Fonte única para preços, labels e mapeamento legado bot/complete.
 */

export type CommercialPlanKey = "essencial" | "pro" | "market";

/** Valores aceitos em APIs/signup (inclui aliases legados). */
export type PlanInputKey = CommercialPlanKey | "bot" | "complete" | "starter";

export const PLAN_ORDER: CommercialPlanKey[] = ["essencial", "pro", "market"];

export const PLAN_CATALOG: Record<
    CommercialPlanKey,
    {
        name: string;
        monthlyPriceCents: number;
        description: string;
        popular?: boolean;
        /** Features booleanas do plano (além das comuns). */
        features: string[];
        /** Crédito IA incluso = 10% do mensal (centavos BRL). */
        aiIncludedCents: number;
    }
> = {
    essencial: {
        name: "Essencial",
        monthlyPriceCents: 19700,
        description: "WhatsApp + cardápio web + IA com crédito + packs",
        features: [
            "whatsapp_messages",
            "ai_parser",
            "assisted_mode",
            "web_menu",
            "ai_credit_packs",
            "pdv_basic",
        ],
        aiIncludedCents: 1970,
    },
    pro: {
        name: "Pro",
        monthlyPriceCents: 27900,
        description: "ERP completo + impressão + IA (canal próprio)",
        popular: true,
        features: [
            "whatsapp_messages",
            "ai_parser",
            "assisted_mode",
            "web_menu",
            "ai_credit_packs",
            "pdv",
            "printing_auto",
            "estoque_full",
            "financeiro_full",
        ],
        aiIncludedCents: 2790,
    },
    market: {
        name: "Market",
        monthlyPriceCents: 34900,
        description: "Tudo do Pro + iFood/Aiqfome + IG/Messenger + mesa + app",
        features: [
            "whatsapp_messages",
            "ai_parser",
            "assisted_mode",
            "web_menu",
            "ai_credit_packs",
            "pdv",
            "printing_auto",
            "estoque_full",
            "financeiro_full",
            "marketplace_ifood",
            "marketplace_aiqfome",
            "omnichannel_ig_messenger",
            "table_service",
            "mobile_app",
        ],
        aiIncludedCents: 3490,
    },
};

export function normalizePlanKey(raw: string | null | undefined): CommercialPlanKey | null {
    const k = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (k === "essencial" || k === "bot" || k === "starter") return "essencial";
    if (k === "pro" || k === "complete") return "pro";
    if (k === "market") return "market";
    return null;
}

/** Aceita só keys comerciais na API pública (rejeita bot/complete/starter). */
export function parseCommercialPlanInput(raw: unknown): CommercialPlanKey | null {
    const k = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (k === "essencial" || k === "pro" || k === "market") return k;
    return null;
}

export function isCommercialPlanKey(raw: string): raw is CommercialPlanKey {
    return parseCommercialPlanInput(raw) !== null;
}

export function getMonthlyPriceCentsForPlan(plan: PlanInputKey | string): number {
    const key = normalizePlanKey(plan);
    if (!key) return PLAN_CATALOG.essencial.monthlyPriceCents;
    return PLAN_CATALOG[key].monthlyPriceCents;
}

export function getPlanLabel(plan: PlanInputKey | string): string {
    const key = normalizePlanKey(plan);
    return key ? PLAN_CATALOG[key].name : String(plan);
}

/** Rank para upgrades (maior = mais alto). */
export function planRank(plan: PlanInputKey | string): number {
    const key = normalizePlanKey(plan);
    if (!key) return 0;
    return PLAN_ORDER.indexOf(key);
}
