/**
 * Remove sufixo de telemetria que o modelo adiciona ao texto visível.
 * O prompt pede INTENT_OK / INTENT_UNKNOWN; na prática vêm variantes com asteriscos e espaços.
 */
export function stripModelIntentSuffix(raw: string): {
    visible: string;
    marker: "ok" | "unknown" | null;
} {
    const t = raw.trimEnd();
    // Última ocorrência no final: opcional * / espaço, marcador, opcional * / espaço.
    const re = /(?:\s*\*?\s*)(INTENT_OK|INTENT_UNKNOWN)(?:\s*\*?\s*)$/iu;
    const m = re.exec(t);
    if (m?.index === undefined) {
        return { visible: t.trim(), marker: null };
    }
    const label = m[1].toUpperCase();
    const marker = label === "INTENT_UNKNOWN" ? "unknown" : "ok";
    const visible = t.slice(0, m.index).trimEnd();
    return { visible, marker };
}

/**
 * Remove o marcador `ADDR_FREE_TEXT` que o modelo adiciona quando respondeu em texto livre
 * sobre endereço (cliente questionou/mencionou entrega em endereço diferente do cadastrado).
 * Independente de `INTENT_OK`/`INTENT_UNKNOWN` — pode vir antes ou depois desse marcador.
 */
export function stripAddressFreeTextMarker(raw: string): {
    visible: string;
    addressFreeText: boolean;
} {
    const t = raw.trimEnd();
    const re = /(?:\s*\*?\s*)(ADDR_FREE_TEXT)(?:\s*\*?\s*)$/iu;
    const m = re.exec(t);
    if (m?.index === undefined) {
        return { visible: t.trim(), addressFreeText: false };
    }
    return { visible: t.slice(0, m.index).trimEnd(), addressFreeText: true };
}
