import { httpsOfferLink, offerLinkLabel } from "@/src/service/domain/offerLink";
import type { ServiceOfferingView } from "@/src/service/domain/types";

export function reaisFromCents(cents: number): string {
    const abs = Math.abs(Math.trunc(cents));
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, "0");
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
    return `${cents < 0 ? "-" : ""}R$ ${grouped},${frac}`;
}

function groupOf(name: string): "Delivery" | "Office" | "outros" {
    if (name.startsWith("Delivery ")) return "Delivery";
    if (name.startsWith("Office ") || name.startsWith("Atendimento ")) return "Office";
    return "outros";
}

export function offeringPriceLabel(offering: ServiceOfferingView): string {
    return planLine(offering);
}

function isPlan(offering: ServiceOfferingView): boolean {
    return /^(?:Delivery|Office|Atendimento) /u.test(offering.name) || offering.name === "Enterprise";
}

export function displayLabel(name: string): string {
    const stripped = name.replace(/^(?:Delivery|Office|Atendimento) /u, "");
    if (stripped.length === 0) return name;
    return stripped.charAt(0).toLocaleUpperCase("pt-BR") + stripped.slice(1);
}

function pricePhrase(offering: ServiceOfferingView): string {
    if (offering.priceCents == null) return "sob consulta";
    if (isPlan(offering) && offering.name.endsWith(" anual")) {
        const perMonth = Math.round(offering.priceCents / 12);
        return `${reaisFromCents(perMonth)} por mês (${reaisFromCents(offering.priceCents)} no ano)`;
    }
    if (isPlan(offering)) return `${reaisFromCents(offering.priceCents)} por mês`;
    const duration = offering.durationMin ? ` · ${offering.durationMin} min` : "";
    return `${reaisFromCents(offering.priceCents)}${duration}`;
}

function planLine(offering: ServiceOfferingView): string {
    return `${displayLabel(offering.name)}: ${pricePhrase(offering)}`;
}

const GROUP_TITLE: Record<"Delivery" | "Office" | "outros", string | null> = {
    Delivery: "Delivery, para loja e entrega:",
    Office: "Office:",
    outros: null,
};

/** Texto pronto para a resposta. Uma linha por plano. O modelo copia, não recalcula. */
export function speakOfferings(offerings: readonly ServiceOfferingView[]): string {
    const blocks: string[] = [];
    for (const key of ["Delivery", "Office", "outros"] as const) {
        const rows = offerings
            .filter((offering) => groupOf(offering.name) === key)
            .sort(compareOfferings);
        if (rows.length === 0) continue;
        const title = GROUP_TITLE[key];
        const lines = rows.map(planLine);
        blocks.push(title ? [title, ...lines].join("\n") : lines.join("\n"));
    }
    if (blocks.length === 0) return "Não há planos ativos agora.";
    return `${blocks.join("\n\n")}\n\nQual desses você tem interesse?`;
}

export function normalizeVisitorPhone(raw: string): string | null {
    const digits = raw.replace(/\D/gu, "");
    const local = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
    if (!/^\d{10,11}$/u.test(local)) return null;
    return `+55${local}`;
}

export function storeWhatsappHref(base: string, interest: string, name: string): string {
    const url = new URL(base);
    url.searchParams.set("text", `Olá, sou ${name}. Tenho interesse em ${interest}.`);
    return url.toString();
}

export const SITE_CONTACT_SAVED = "Pronto. Toque em Continuar no WhatsApp.";

export const SITE_PLAN_PAGE_HINT =
    "Os planos estão nesta página. No topo, clique em Planos. No celular, abra o menu e toque em Planos.";

const PLAN_FAMILY_RE = /\b(essencial|market|enterprise|pro|atendimento|mensal|anual)\b/iu;
const PRICE_ASK_RE = /\b(quanto|pre[cç]os?|valores?|custa|tabela)\b/iu;

/** Pedido para ver ou precificar plano. Dúvida solta, como prazo ou taxa, não entra. */
export function asksForPlanPage(text: string): boolean {
    if (/\bplanos?\b/iu.test(text)) return true;
    return PRICE_ASK_RE.test(text) && PLAN_FAMILY_RE.test(text);
}

const CATALOG_RE = /\b(planos?|pre[cç]os?|valores?|quanto|tabela|custa|assinatura|produtos?|op[cç][õo]es)\b/iu;
const FAMILY_RE = /\b(essencial|market|enterprise|pro|atendimento|mensal|anual)\b/iu;

const NAME_STOP = new Set([
    "quero", "meu", "minha", "nome", "whatsapp", "zap", "telefone", "numero", "número",
    "interesse", "plano", "mensal", "anual", "delivery", "atendimento", "essencial",
    "pro", "market", "enterprise", "sou", "ola", "olá", "oi", "com", "para", "pra",
    "ddd", "chamar", "loja", "pode", "chamar", "chama", "chamo", "mim", "me", "de",
    "da", "do", "dos", "das", "e", "o", "a", "os", "as", "um", "uma", "no", "na",
]);

export function benefitLines(description: string | null): string[] {
    if (!description) return [];
    const raw = description.includes("\n") ? description.split(/\n/u) : description.split(/\.\s+/u);
    return raw
        .map((line) => line.replace(/^[•\-]\s*/u, "").trim().replace(/[.;]$/u, ""))
        .filter((line) => line.length > 1 && !/^r\$/iu.test(line) && !/^mensalidade$/iu.test(line));
}

export function benefitSpeech(offering: ServiceOfferingView, askContact: boolean): string {
    const lines = [displayLabel(offering.name), pricePhrase(offering), "", ...benefitLines(offering.description)];
    if (askContact) {
        lines.push("", "Me passa seu nome e seu WhatsApp com DDD?");
    }
    return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export function looksLikeSales(text: string): boolean {
    return CATALOG_RE.test(text) || FAMILY_RE.test(text) || normalizeVisitorPhone(text) !== null;
}

export type SitePlanOption = {
    offeringId: string;
    label: string;
    price: string;
    note: string | null;
};

export type SitePlanCard = {
    title: string;
    benefits: string[];
    options: SitePlanOption[];
};

export type SiteSalesStep =
    | { kind: "catalog" | "ask_name" | "ask_plan"; body: string }
    | { kind: "benefits"; body: string; offering: ServiceOfferingView }
    | { kind: "period"; body: string; rows: ServiceOfferingView[] }
    | { kind: "save"; name: string; phone: string; interest: string };

export const WHATSAPP_PLAN_INTRO =
    "Estes são os planos. Toque no botão para abrir o cadastro com esse plano.";

export type WhatsappPlanBubble =
    | { kind: "cta"; body: string; label: string; url: string }
    | { kind: "text"; body: string };

function compareOfferings(a: ServiceOfferingView, b: ServiceOfferingView): number {
    const family = (name: string) =>
        name.includes("Essencial") ? 0 : /\bPro\b/u.test(name) ? 1 : name.includes("Market") ? 2 : 3;
    const period = (name: string) => (name.endsWith(" mensal") ? 0 : name.endsWith(" anual") ? 1 : 2);
    return family(a.name) - family(b.name) || period(a.name) - period(b.name) || a.name.localeCompare(b.name, "pt-BR");
}

function orderedOfferings(offerings: readonly ServiceOfferingView[]): ServiceOfferingView[] {
    const out: ServiceOfferingView[] = [];
    for (const key of ["Delivery", "Office", "outros"] as const) {
        out.push(...offerings.filter((offering) => groupOf(offering.name) === key).sort(compareOfferings));
    }
    return out;
}

function planMessageTitle(name: string): string {
    const lower = name.toLocaleLowerCase("pt-BR");
    if (lower.startsWith("atendimento ") || lower.startsWith("office ")) {
        return `Office ${displayLabel(name).toLocaleLowerCase("pt-BR")}`;
    }
    return displayLabel(name);
}

function planSignupBody(offering: ServiceOfferingView): string {
    const lines = [planMessageTitle(offering.name), pricePhrase(offering)];
    const kept: string[] = [];
    let size = lines.join("\n").length;
    for (const line of benefitLines(offering.description)) {
        if (size + line.length + 2 > 900) break;
        kept.push(line);
        size += line.length + 1;
    }
    if (kept.length > 0) lines.push("", ...kept);
    return lines.join("\n");
}

export function whatsappPlanBubbles(rows: readonly ServiceOfferingView[]): WhatsappPlanBubble[] {
    const bubbles: WhatsappPlanBubble[] = [];
    for (const row of orderedOfferings(rows)) {
        const url = httpsOfferLink(row.linkUrl);
        if (url) {
            bubbles.push({
                kind: "cta",
                body: planSignupBody(row),
                label: offerLinkLabel(row.linkLabel),
                url,
            });
            continue;
        }
        const lower = row.name.toLocaleLowerCase("pt-BR");
        if (lower === "enterprise" || lower.startsWith("enterprise ")) {
            bubbles.push({
                kind: "text",
                body: "Enterprise: sob consulta. Me chama que a gente monta com você.",
            });
        }
    }
    return bubbles;
}

function familyPool(rows: readonly ServiceOfferingView[], text: string): ServiceOfferingView[] {
    const folded = text.toLocaleLowerCase("pt-BR");
    const annual = /\banual\b/u.test(folded);
    const month = /\bmensal\b/u.test(folded);
    const families: string[] = [];
    if (/\bessencial\b/u.test(folded)) families.push("essencial");
    if (/\bmarket\b/u.test(folded)) families.push("market");
    if (/\benterprise\b/u.test(folded) || /\binterprise\b/u.test(folded)) families.push("enterprise");
    if (/\bpro\b/u.test(folded)) families.push("pro");
    if (/\boffice\b/u.test(folded) || /\batendimento\b/u.test(folded)) families.push("office");
    if (families.length === 0 && !annual && !month) return [];

    let pool = rows.filter((row) => {
        const name = row.name.toLocaleLowerCase("pt-BR");
        if (families.length === 0) return true;
        return families.some((family) => {
            if (family === "pro") return /\bpro\b/u.test(name);
            if (family === "office") return name.startsWith("office ") || name.startsWith("atendimento ");
            return name.includes(family);
        });
    });
    if (annual !== month) {
        const period = annual ? " anual" : " mensal";
        const narrowed = pool.filter((row) => row.name.toLocaleLowerCase("pt-BR").endsWith(period));
        if (narrowed.length > 0) pool = narrowed;
    }
    return pool;
}

function periodWord(text: string): "anual" | "mensal" | null {
    const folded = text.trim().toLocaleLowerCase("pt-BR");
    const match = /^(?:o |a )?(anual|mensal)$/u.exec(folded);
    if (match?.[1] === "anual" || match?.[1] === "mensal") return match[1];
    return null;
}

function narrowByPriorPeriod(
    rows: readonly ServiceOfferingView[],
    text: string,
    prior: readonly { role: "user" | "assistant"; text: string }[]
): ServiceOfferingView[] | null {
    const period = periodWord(text);
    if (!period) return null;
    const previous = [...prior].reverse().find((turn) => turn.role === "user" && familyPool(rows, turn.text).length > 0);
    if (!previous) return null;
    const base = familyPool(rows, previous.text);
    const narrowed = base.filter((row) => row.name.toLocaleLowerCase("pt-BR").endsWith(` ${period}`));
    if (narrowed.length > 0) return narrowed;
    if (base.length === 1) return base;
    return null;
}

const CARD_FAMILIES: { title: string; test: (name: string) => boolean }[] = [
    { title: "Essencial", test: (name) => name.includes("essencial") },
    { title: "Pro", test: (name) => /\bpro\b/u.test(name) },
    { title: "Market", test: (name) => name.includes("market") },
    { title: "Office", test: (name) => name.startsWith("office ") || name.startsWith("atendimento") },
    { title: "Enterprise", test: (name) => name === "enterprise" || name.startsWith("enterprise ") },
];

function optionFrom(offering: ServiceOfferingView, label: string): SitePlanOption {
    if (offering.priceCents == null) return { offeringId: offering.id, label, price: "Sob consulta", note: null };
    if (isPlan(offering) && offering.name.endsWith(" anual")) {
        const perMonth = Math.round(offering.priceCents / 12);
        return {
            offeringId: offering.id,
            label,
            price: `${reaisFromCents(perMonth)}/mês`,
            note: `${reaisFromCents(offering.priceCents)} no ano`,
        };
    }
    if (isPlan(offering)) {
        return { offeringId: offering.id, label, price: `${reaisFromCents(offering.priceCents)}/mês`, note: null };
    }
    return { offeringId: offering.id, label, price: pricePhrase(offering), note: null };
}

export function planCards(rows: readonly ServiceOfferingView[]): SitePlanCard[] {
    const used = new Set<string>();
    const cards: SitePlanCard[] = [];
    for (const family of CARD_FAMILIES) {
        const members = rows.filter((row) => family.test(row.name.toLocaleLowerCase("pt-BR")) && !used.has(row.id));
        if (members.length === 0) continue;
        for (const row of members) used.add(row.id);
        const month = members.find((row) => row.name.endsWith(" mensal"));
        const year = members.find((row) => row.name.endsWith(" anual"));
        const source = month ?? year ?? members[0];
        if (!source) continue;
        const options = [
            month ? optionFrom(month, "Mensal") : null,
            year ? optionFrom(year, "Anual") : null,
        ].filter((option): option is SitePlanOption => option !== null);
        cards.push({
            title: family.title,
            benefits: benefitLines(source.description).slice(0, 4),
            options: options.length > 0 ? options : [optionFrom(source, "Quero este")],
        });
    }
    for (const row of rows) {
        if (used.has(row.id) || cards.length >= 6) continue;
        used.add(row.id);
        cards.push({
            title: displayLabel(row.name),
            benefits: benefitLines(row.description).slice(0, 4),
            options: [optionFrom(row, "Quero este")],
        });
    }
    return cards.slice(0, 6);
}

function chosenSpeech(offering: ServiceOfferingView): string {
    return [
        `${displayLabel(offering.name)} · ${pricePhrase(offering)}`,
        "",
        "Me passa seu nome e seu WhatsApp com DDD?",
    ].join("\n");
}

export function matchOfferings(rows: readonly ServiceOfferingView[], text: string): ServiceOfferingView[] {
    return familyPool(rows, text);
}

function chosenOffering(
    rows: readonly ServiceOfferingView[],
    text: string,
    prior: readonly { role: "user" | "assistant"; text: string }[]
): ServiceOfferingView | null {
    const texts = [text, ...prior.filter((turn) => turn.role === "user").map((turn) => turn.text).reverse()];
    for (const item of texts) {
        const found = familyPool(rows, item);
        if (found.length === 1) return found[0] ?? null;
    }
    return null;
}

export function visitorName(text: string): string | null {
    const words = text
        .replace(/\+?\d[\d\s().-]{8,}\d/gu, " ")
        .replace(/[^\p{L}\s]/gu, " ")
        .split(/\s+/u)
        .filter((word) => word.length >= 2 && !NAME_STOP.has(word.toLocaleLowerCase("pt-BR")));
    if (words.length === 0) return null;
    const name = words.slice(0, 3).join(" ");
    if (name.length < 2 || name.length > 80) return null;
    return name;
}

export function siteSalesStep(
    text: string,
    rows: readonly ServiceOfferingView[],
    prior: readonly { role: "user" | "assistant"; text: string }[],
    collectContact: boolean,
    offeringId?: string | null
): SiteSalesStep | null {
    if (offeringId) {
        const picked = rows.find((row) => row.id === offeringId);
        if (picked) return { kind: "benefits", body: chosenSpeech(picked), offering: picked };
    }
    const phone = normalizeVisitorPhone(text);
    const name = visitorName(text);
    if (collectContact && phone && name) {
        const chosen = chosenOffering(rows, text, prior);
        if (!chosen) {
            return { kind: "ask_plan", body: "Anotei seu nome e seu WhatsApp. Qual plano você quer, mensal ou anual?" };
        }
        return { kind: "save", name, phone, interest: chosen.name };
    }
    if (collectContact && phone) {
        return { kind: "ask_name", body: "Me passa também o seu nome? O WhatsApp eu já anotei." };
    }
    const matched = narrowByPriorPeriod(rows, text, prior) ?? familyPool(rows, text);
    if (matched.length === 1) {
        const only = matched[0];
        if (!only) return null;
        return { kind: "benefits", body: benefitSpeech(only, collectContact), offering: only };
    }
    if (matched.length > 1) {
        return { kind: "period", body: `${matched.map(planLine).join("\n")}\n\nQual desses você tem interesse?`, rows: matched };
    }
    if (CATALOG_RE.test(text)) return { kind: "catalog", body: speakOfferings(rows) };
    return null;
}
