/**
 * WhatsApp: título do botão máx. 20 chars e **deve ser único** na mensagem.
 * "ORIGINAL TREZENTINHA" e "ORIGINAL TREZENTINHA (CX…)" colidem no slice(0,20).
 */
export function formatPickButtonTitle(label: string, indexZeroBased: number): string {
    const base = String(label ?? `Opcao ${indexZeroBased + 1}`)
        .replaceAll(/\s+/g, " ")
        .trim();
    const prefix = `${indexZeroBased + 1}) `;
    return `${prefix}${base}`.slice(0, 20);
}

export function buildUniquePickButtons(
    picks: Array<{ embalagemId: string; label: string }>,
    idPrefix: string
): Array<{ id: string; title: string }> {
    const used = new Set<string>();
    return picks.slice(0, 3).map((p, i) => {
        let title = formatPickButtonTitle(p.label, i);
        if (used.has(title.toLowerCase())) {
            title = `${i + 1}-${String(p.embalagemId).slice(0, 8)}`.slice(0, 20);
        }
        used.add(title.toLowerCase());
        return {
            id: `${idPrefix}${p.embalagemId}`,
            title,
        };
    });
}
