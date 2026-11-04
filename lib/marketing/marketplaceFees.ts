/**
 * Referência pública de comissão — entrega da própria loja, pedido pago no app.
 * Não é cotação. O contrato da cidade pode ser outro.
 * Conferido em novembro de 2026.
 */

export type MarketplaceFeeRef = {
    id: "ifood" | "aiqfome" | "food99";
    name: string;
    /** Pontos-base sobre o pedido (15,2% = 1520). Já soma a taxa de pagamento no app quando ela é à parte. */
    takeRateBps: number;
    monthlyFeeCents: number;
    /** Mensalidade só entra se o volume no app passar deste valor. 0 = sem isenção publicada. */
    monthlyFeeExemptUpToCents: number;
    detail: string;
    sourceLabel: string;
    sourceUrl: string;
};

/** Volume do exemplo da landing: R$ 10.000 em pedidos no mês. */
export const SAVINGS_EXAMPLE_VOLUME_CENTS = 1_000_000;

export const MARKETPLACE_OWN_DELIVERY: readonly MarketplaceFeeRef[] = [
    {
        id: "ifood",
        name: "iFood · Plano Básico",
        takeRateBps: 1520,
        monthlyFeeCents: 11_000,
        monthlyFeeExemptUpToCents: 180_000,
        detail: "12% de comissão + 3,2% quando o pedido é pago no app. Mensalidade de R$ 110 só acima de R$ 1.800 no mês. Os cards oficiais mostram 3,2%; uma página de entregas do iFood cita 3,5%.",
        sourceLabel: "Planos iFood para restaurantes",
        sourceUrl: "https://parceiros.ifood.com.br/restaurante/planos-ifood",
    },
    {
        id: "aiqfome",
        name: "Aiqfome · entrega da loja",
        takeRateBps: 1499,
        monthlyFeeCents: 8_990,
        monthlyFeeExemptUpToCents: 150_000,
        detail: "Taxa única de 14,99% no portal nacional de parceiros, já sem taxa extra de pagamento. Mensalidade de R$ 89,90 só acima de R$ 1.500 no mês. Outras cidades publicam percentual diferente.",
        sourceLabel: "Portal de parceiros Aiqfome",
        sourceUrl: "https://www.parceiros.aiqfome.com/",
    },
    {
        id: "food99",
        name: "99Food · entrega da loja",
        takeRateBps: 1410,
        monthlyFeeCents: 0,
        monthlyFeeExemptUpToCents: 0,
        detail: "10,9% de comissão na entrega da loja, informados pela 99Food à Abrasel-RS, mais 3,2% de pagamento no app citado em guias de 2026. Mensalidade e custo por km ficam no contrato; nesta conta a entrega é da loja, então o km da plataforma não entra.",
        sourceLabel: "Abrasel-RS — taxas 99Food",
        sourceUrl: "https://rs.abrasel.com.br/noticias/noticias/novo-player-de-delivery-abrasel-promove-live-exclusiva-para-associados-sobre-chegada-da-99food-a-porto-alegre/",
    },
] as const;

export function formatBrlFromCents(cents: number): string {
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Comissão + mensalidade aplicável. Arredonda a comissão no centavo. */
export function marketplaceCostCents(volumeCents: number, ref: MarketplaceFeeRef): number {
    if (volumeCents <= 0) return 0;
    const commission = Math.round((volumeCents * ref.takeRateBps) / 10_000);
    const fee =
        ref.monthlyFeeCents > 0 && volumeCents > ref.monthlyFeeExemptUpToCents
            ? ref.monthlyFeeCents
            : 0;
    return commission + fee;
}

export function takeRateLabel(bps: number): string {
    return (bps / 100).toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
    });
}

export type SavingsExampleRow = {
    id: string;
    name: string;
    takeLabel: string;
    costCents: number;
    detail: string;
    sourceLabel: string;
    sourceUrl: string;
};

export function savingsExample(zampellMonthlyCents: number): {
    volumeCents: number;
    rows: SavingsExampleRow[];
    zampellCents: number;
    keptVersus: { id: string; name: string; keptCents: number }[];
} {
    const volumeCents = SAVINGS_EXAMPLE_VOLUME_CENTS;
    const rows = MARKETPLACE_OWN_DELIVERY.map((ref) => {
        const feeApplies =
            ref.monthlyFeeCents > 0 && volumeCents > ref.monthlyFeeExemptUpToCents;
        const takeLabel = feeApplies
            ? `${takeRateLabel(ref.takeRateBps)}% + ${formatBrlFromCents(ref.monthlyFeeCents)}`
            : `${takeRateLabel(ref.takeRateBps)}%`;
        return {
            id: ref.id,
            name: ref.name,
            takeLabel,
            costCents: marketplaceCostCents(volumeCents, ref),
            detail: ref.detail,
            sourceLabel: ref.sourceLabel,
            sourceUrl: ref.sourceUrl,
        };
    });
    return {
        volumeCents,
        rows,
        zampellCents: zampellMonthlyCents,
        keptVersus: rows.map((row) => ({
            id: row.id,
            name: row.name,
            keptCents: row.costCents - zampellMonthlyCents,
        })),
    };
}
