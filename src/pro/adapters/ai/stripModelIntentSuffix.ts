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
