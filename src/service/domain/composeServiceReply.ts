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

function keepSentence(sentence: string, writes: TurnWrites): boolean {
    if (!writes.booked && claims(sentence, BOOKED_RE)) return false;
    if (!writes.cancelled && claims(sentence, CANCELLED_RE)) return false;
    if (!writes.rescheduled && claims(sentence, RESCHEDULED_RE)) return false;
    if (!writes.caseOpened && claims(sentence, CASE_RE)) return false;
    return true;
}

export function composeServiceReply(reply: string, writes: TurnWrites): string {
    const kept = reply.split("\n").map((line) => {
        if (line.trim().length === 0) return "";
        return splitSentences(line).filter((sentence) => keepSentence(sentence, writes)).join(" ");
    });

    let text = kept.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
    const extras: string[] = [];
    if (writes.booked && !claims(text, BOOKED_RE)) extras.push("Horário marcado.");
    if (writes.cancelled && !claims(text, CANCELLED_RE)) extras.push("Horário cancelado.");
    if (writes.rescheduled && !claims(text, RESCHEDULED_RE)) extras.push("Horário remarcado.");
    if (writes.caseOpened && !claims(text, CASE_RE)) extras.push("Card aberto.");
    if (extras.length > 0) text = text.length > 0 ? `${text}\n${extras.join(" ")}` : extras.join(" ");
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
        case "calendar_unavailable":
            return "Não consegui consultar a agenda agora. Pode tentar de novo?";
        default:
            return "Não consegui concluir isso agora. Pode tentar de novo ou pedir um atendente.";
    }
}
