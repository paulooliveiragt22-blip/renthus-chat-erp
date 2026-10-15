/** Rótulos da leitura `v_sec_bot_readiness` (ADR 0013 D4). O booleano `ready` nasce na view. */

export type BotReadinessFlags = {
    hasSalePrice: boolean;
    hasStock: boolean;
    hasCommercialSigla: boolean;
    hasDeliveryZoneFee: boolean;
    hasOpeningHours: boolean;
    hasStoreAddress: boolean;
};

export const BOT_READINESS_CHECKS: ReadonlyArray<{
    key: keyof BotReadinessFlags;
    label: string;
}> = [
    { key: "hasSalePrice", label: "Preço de venda em alguma embalagem" },
    { key: "hasStock", label: "Estoque em algum produto" },
    { key: "hasCommercialSigla", label: "Sigla comercial na embalagem" },
    { key: "hasDeliveryZoneFee", label: "Zona de entrega com taxa" },
    { key: "hasOpeningHours", label: "Horário de funcionamento" },
    { key: "hasStoreAddress", label: "Endereço da loja" },
];

export function botReadinessChecks(flags: BotReadinessFlags): Array<{ label: string; ok: boolean }> {
    return BOT_READINESS_CHECKS.map((check) => ({
        label: check.label,
        ok: flags[check.key] === true,
    }));
}

export function botReadinessGaps(flags: BotReadinessFlags): string[] {
    return botReadinessChecks(flags)
        .filter((check) => !check.ok)
        .map((check) => check.label);
}
