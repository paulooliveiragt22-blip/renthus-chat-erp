import { normalizeVisitorPhone, visitorName } from "@/src/service/domain/offeringSpeech";

export const SITE_SUPPORT_ASK_NAME =
    "Não tenho essa resposta. Me passa seu nome para o suporte te chamar?";
export const SITE_SUPPORT_ASK_PHONE = "Agora me passa seu WhatsApp com DDD.";
export const SITE_SUPPORT_INTEREST = "Suporte";

const NAME_MARK = "Me passa seu nome para o suporte";
const PHONE_MARK = "Agora me passa seu WhatsApp com DDD";

export type SiteSupportStep =
    | { kind: "ask_name" }
    | { kind: "ask_phone" }
    | { kind: "save"; name: string; phone: string };

function waitingFor(
    prior: readonly { role: "user" | "assistant"; text: string }[]
): "name" | "phone" | null {
    for (let index = prior.length - 1; index >= 0; index -= 1) {
        const turn = prior[index];
        if (!turn || turn.role !== "assistant") continue;
        if (turn.text.includes(PHONE_MARK)) return "phone";
        if (turn.text.includes(NAME_MARK)) return "name";
        return null;
    }
    return null;
}

function rememberedName(
    prior: readonly { role: "user" | "assistant"; text: string }[]
): string | null {
    let capture = false;
    let name: string | null = null;
    for (const turn of prior) {
        if (turn.role === "assistant" && turn.text.includes(NAME_MARK)) {
            capture = true;
            continue;
        }
        if (capture && turn.role === "user") {
            name = visitorName(turn.text);
            capture = false;
        }
    }
    return name;
}

/** Continua o suporte só depois que o chat já pediu nome ou WhatsApp. */
export function siteSupportStep(
    text: string,
    prior: readonly { role: "user" | "assistant"; text: string }[]
): SiteSupportStep | null {
    const waiting = waitingFor(prior);
    if (!waiting) return null;
    const phone = normalizeVisitorPhone(text);
    if (waiting === "name") {
        const name = visitorName(text);
        if (name && phone) return { kind: "save", name, phone };
        if (name) return { kind: "ask_phone" };
        return { kind: "ask_name" };
    }
    const name = rememberedName(prior) ?? visitorName(text);
    if (name && phone) return { kind: "save", name, phone };
    if (!phone) return { kind: "ask_phone" };
    return { kind: "ask_name" };
}
