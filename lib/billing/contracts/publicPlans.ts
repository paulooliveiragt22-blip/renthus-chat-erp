/**
 * Contrato público — vitrine /signup apenas.
 * Nunca expor no ERP do tenant (cliente não contrata promo dentro do app).
 */

export type UiPublicPlanPromo = {
    duration_months: number;
    list_monthly_cents: number;
    offer_monthly_cents: number;
    /** Texto canônico: "De R$ X por R$ Y" */
    label_de_por: string;
};

export type UiPublicPlanOffer = {
    key: string;
    name: string;
    description: string | null;
    list_monthly_cents: number;
    offer_monthly_cents: number;
    list_yearly_cents: number | null;
    included_seats: number | null;
    seat_extra_cents: number | null;
    popular: boolean;
    promo: UiPublicPlanPromo | null;
};
