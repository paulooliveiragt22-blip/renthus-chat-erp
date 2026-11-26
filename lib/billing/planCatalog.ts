/**
 * Catálogo comercial canônico — Essencial / Pro / Market.
 * Fonte única para preços, labels e mapeamento legado bot/complete.
 * Preços BN-04 (2026-09): 279 / 349 / 449; anual default −20% (editável no DB).
 */

export type CommercialPlanKey = "essencial" | "pro" | "market";

/** Plano do Office. Fora da escada Essencial → Pro → Market. */
export const OFFICE_PLAN_KEY = "office" as const;

export type OfficePlanKey = typeof OFFICE_PLAN_KEY;

export type SignupPlanKey = CommercialPlanKey | OfficePlanKey;

export const OFFICE_PLAN = {
    name: "Office",
    monthlyPriceCents: 15_900,
    /** À vista. Não é mensal × 12 × 0,8. */
    yearlyPriceCents: 119_880,
    yearlyDiscountMode: "fixed_brl" as const,
    /** Centavos tirados de 12 × mensal para fechar R$ 1.198,80. */
    yearlyDiscountCents: 70_920,
    aiIncludedCents: 1_590,
    includedSeats: 1,
    seatExtraCents: null,
    features: [
        "whatsapp_messages",
        "ai_parser",
        "assisted_mode",
        "ai_credit_packs",
        "whatsapp_templates_broadcast",
    ],
} as const;

export function isOfficePlanKey(raw: unknown): raw is OfficePlanKey {
    return String(raw ?? "").trim().toLowerCase() === OFFICE_PLAN_KEY;
}

/** Valores aceitos em APIs/signup (inclui aliases legados). */
export type PlanInputKey = CommercialPlanKey | "bot" | "complete" | "starter";

export const PLAN_ORDER: CommercialPlanKey[] = ["essencial", "pro", "market"];

/** Default anual = mensal × 12 × 0,8 (R2-B). */
export function defaultYearlyCentsFromMonthly(monthlyCents: number): number {
    return Math.round(monthlyCents * 12 * 0.8);
}

export const PLAN_CATALOG: Record<
    CommercialPlanKey,
    {
        name: string;
        monthlyPriceCents: number;
        /** Lista anual (default 20% off; canônico no código até admin gravar `plans.price_year_cents`). */
        yearlyPriceCents: number;
        description: string;
        popular?: boolean;
        /** Features booleanas do plano (além das comuns). */
        features: string[];
        /** Espelho UX. Canônico = fn_billing_ai_included_cents(plans.price_cents). */
        aiIncludedCents: number;
        /** Usuários inclusos no preço (BN-17 / R2-C). */
        includedSeats: number;
        /**
         * Seat adicional R$/mês (centavos). `null` = Essencial hard-cap (sem compra de extra).
         */
        seatExtraCents: number | null;
    }
> = {
    essencial: {
        name: "Essencial",
        monthlyPriceCents: 27900,
        yearlyPriceCents: defaultYearlyCentsFromMonthly(27900),
        description: "Agente no WhatsApp + cardápio + PDV básico",
        features: [
            "whatsapp_messages",
            "ai_parser",
            "assisted_mode",
            "web_menu",
            "ai_credit_packs",
            "pdv_basic",
        ],
        aiIncludedCents: 2790,
        includedSeats: 1,
        seatExtraCents: null,
    },
    pro: {
        name: "Pro",
        monthlyPriceCents: 34900,
        yearlyPriceCents: defaultYearlyCentsFromMonthly(34900),
        description: "Operação completa: PDV, estoque, financeiro e impressão",
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
            "whatsapp_templates_broadcast",
        ],
        aiIncludedCents: 3490,
        includedSeats: 1,
        seatExtraCents: 9900,
    },
    market: {
        name: "Market",
        monthlyPriceCents: 44900,
        yearlyPriceCents: defaultYearlyCentsFromMonthly(44900),
        description: "Operação com mais gente no painel",
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
            "whatsapp_templates_broadcast",
        ],
        aiIncludedCents: 4490,
        includedSeats: 10,
        seatExtraCents: 9900,
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

/** Checkout público: a escada de delivery ou o plano Office. */
export function parseSignupPlan(raw: unknown): SignupPlanKey | null {
    const commercial = parseCommercialPlanInput(raw);
    if (commercial) return commercial;
    return isOfficePlanKey(raw) ? OFFICE_PLAN_KEY : null;
}

export function isCommercialPlanKey(raw: string): raw is CommercialPlanKey {
    return parseCommercialPlanInput(raw) !== null;
}

export function getMonthlyPriceCentsForPlan(plan: PlanInputKey | string): number {
    if (isOfficePlanKey(plan)) return OFFICE_PLAN.monthlyPriceCents;
    const key = normalizePlanKey(plan);
    if (!key) return PLAN_CATALOG.essencial.monthlyPriceCents;
    return PLAN_CATALOG[key].monthlyPriceCents;
}

export function getYearlyPriceCentsForPlan(plan: PlanInputKey | string): number {
    if (isOfficePlanKey(plan)) return OFFICE_PLAN.yearlyPriceCents;
    const key = normalizePlanKey(plan);
    if (!key) return PLAN_CATALOG.essencial.yearlyPriceCents;
    return PLAN_CATALOG[key].yearlyPriceCents;
}

export function getPlanLabel(plan: PlanInputKey | string): string {
    if (isOfficePlanKey(plan)) return OFFICE_PLAN.name;
    const key = normalizePlanKey(plan);
    return key ? PLAN_CATALOG[key].name : String(plan);
}

/** Rank para upgrades (maior = mais alto). */
export function planRank(plan: PlanInputKey | string): number {
    if (isOfficePlanKey(plan)) return -1;
    const key = normalizePlanKey(plan);
    if (!key) return 0;
    return PLAN_ORDER.indexOf(key);
}
