/**
 * FAQ de horário de atendimento — resposta determinística (sem LLM).
 */

import {
    formatHoursLabel,
    isStoreOpen,
    type StoreHours,
} from "@/lib/delivery/hours";

const HOURS_RE =
    /(?:que\s+horas|qual\s+(?:o\s+)?hor[aá]rio|hor[aá]rio\s+de\s+(?:atendimento|funcionamento)|voc[eê]s?\s+(?:est[aã]o|fica[m]?)\s+abert|at[eé]\s+que\s+horas|abr[ei]m?\s+(?:hoje|agora)|funcionam?\s+(?:hoje|agora)|est[aá]\s+aberto)/iu;

export function looksLikeStoreHoursQuestion(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 120) return false;
    return HOURS_RE.test(t);
}

export function buildStoreHoursFaqReply(hours: StoreHours, nowMs = Date.now()): string {
    const label = formatHoursLabel(hours);
    const open = isStoreOpen(nowMs, hours);

    if (!hours.periods.length) {
        return open
            ? "Estamos atendendo agora. Pode me dizer o que deseja pedir?"
            : "No momento não estamos atendendo. Pode tentar mais tarde.";
    }

    if (open) {
        return `Estamos abertos agora. Horário de atendimento: *${label}*. O que deseja pedir?`;
    }

    return `No momento estamos fechados. Nosso horário: *${label}*.`;
}
