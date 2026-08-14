/** IDs estáveis das contas sistema. Canônico: docs/FINANCEIRO.md */

export const SYSTEM_ACCOUNT_IDS = {
    cash: "00000000-0001-0000-0000-000000000101",
    ar: "00000000-0001-0000-0000-000000000102",
    ap: "00000000-0001-0000-0000-000000000201",
    revenue: "00000000-0001-0000-0000-000000000301",
    deliveryFee: "00000000-0001-0000-0000-000000000302",
    serviceFee: "00000000-0001-0000-0000-000000000303",
    opex: "00000000-0001-0000-0000-000000000402",
    adjustments: "00000000-0001-0000-0000-000000000501",
} as const;

export const SYSTEM_ACCOUNT_CODES = {
    cash: "1.1",
    ar: "1.2",
    ap: "2.1",
    revenue: "3.1",
    deliveryFee: "3.2",
    serviceFee: "3.3",
    opex: "4.2",
    adjustments: "5.1",
} as const;
