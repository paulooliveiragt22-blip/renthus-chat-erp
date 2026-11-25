import type { TurnWrites } from "./types";

const BOOKED_RE = /\b(marquei|marcamos|marcado|marcada|agendei|agendamos|agendado|agendada)\b/iu;
const CANCELLED_RE = /\b(cancelei|cancelamos|cancelado|cancelada)\b/iu;
const RESCHEDULED_RE = /\b(remarquei|remarcamos|remarcado|remarcada)\b/iu;
const CASE_RE = /\b(card aberto|abri o card|abri um card|abri seu card|caso aberto)\b/iu;

function negated(sentence: string, claim: RegExp): boolean {
    const match = claim.exec(sentence);
    if (!match || match.index == null) return false;
    const before = sentence.slice(Math.max(0, match.index - 24), match.index);
    return /\bn[aã]o\b/iu.test(before);
}

function claims(sentence: string, claim: RegExp): boolean {
    claim.lastIndex = 0;
    if (!claim.test(sentence)) return false;
    claim.lastIndex = 0;
    return !negated(sentence, claim);
}

function splitSentences(text: string): string[] {
    return text
        .split(/\n+|(?<=[.!?])\s+/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

export function composeServiceReply(reply: string, writes: TurnWrites): string {
    const kept = splitSentences(reply).filter((sentence) => {
        if (!writes.booked && claims(sentence, BOOKED_RE)) return false;
        if (!writes.cancelled && claims(sentence, CANCELLED_RE)) return false;
        if (!writes.rescheduled && claims(sentence, RESCHEDULED_RE)) return false;
        if (!writes.caseOpened && claims(sentence, CASE_RE)) return false;
        return true;
    });

    const parts = [...kept];
    const joined = parts.join(" ");
    if (writes.booked && !claims(joined, BOOKED_RE)) parts.push("Horário marcado.");
    if (writes.cancelled && !claims(joined, CANCELLED_RE)) parts.push("Horário cancelado.");
    if (writes.rescheduled && !claims(joined, RESCHEDULED_RE)) parts.push("Horário remarcado.");
    if (writes.caseOpened && !claims(joined, CASE_RE)) parts.push("Card aberto.");

    const text = parts.join(" ").trim();
    if (text.length > 0) return text;
    return "Pode me dizer de outro jeito o que você precisa?";
}

export function serviceFailureText(code: string): string {
    switch (code) {
        case "offer_expired":
            return "Esse horário não está mais disponível. Me peça outro.";
        case "slot_taken":
            return "Esse horário acabou de ser ocupado. Me peça outro.";
        case "cap_reached":
            return "Você já chegou no limite de horários ou cards abertos.";
        case "agenda_off":
        case "no_hours":
            return "A agenda não está aberta para marcar por aqui.";
        case "cases_off":
            return "Não estou abrindo card por aqui.";
        case "flag_off":
            return "Esse pedido pelo WhatsApp está fechado. Se quiser, peça um atendente.";
        case "outside_hours":
            return "Esse horário está fora do expediente. Me peça outro.";
        default:
            return "Não consegui concluir isso agora. Pode tentar de novo ou pedir um atendente.";
    }
}
