import { yearlySavingsPercent } from "@/lib/billing/yearlyFromDiscount";
import { SITE_CHAT_WHATSAPP_HREF } from "@/lib/marketing/copy";

/** Oferta pública da página. Ainda não é linha em `plans` nem `plan_key`. */
export const ATTENDANCE_MONTHLY_CENTS = 15_900;
/** Valor por mês na vista anual, no mesmo desenho do card de delivery. */
export const ATTENDANCE_YEARLY_PER_MONTH_CENTS = 9_990;
export const ATTENDANCE_YEARLY_CENTS = ATTENDANCE_YEARLY_PER_MONTH_CENTS * 12;

export const ATTENDANCE_FEATURES = [
    { label: "Agente de IA no WhatsApp", ai: true },
    { label: "Agenda com confirmação no botão", ai: false },
    { label: "Card do serviço", ai: false },
] as const;

export const ATTENDANCE_HERO = {
    lead: "Agente de IA",
    beforeAccent: "direto no",
    accent: "WhatsApp",
} as const;

export const ATTENDANCE_POINTS = [
    {
        title: "Turbine seu WhatsApp",
        body: "Atendimento 24h por dia, agendando, tirando dúvidas e fechando vendas.",
    },
    {
        title: "Recupere leads perdidos",
        body: "Envio de mensagens automáticas para potenciais clientes que ficaram perdidos nas conversas.",
    },
    {
        title: "Envio em massa",
        body: "Envie mensagens de marketing e potencialize suas vendas.",
    },
] as const;

export const ATTENDANCE_FOOTER = [
    {
        title: "Produto",
        links: [
            { label: "Agente no WhatsApp", href: "#produto" },
            { label: "Planos", href: "#planos" },
        ],
    },
    {
        title: "Operação",
        links: [{ label: "Dúvidas", href: "#faq" }],
    },
    {
        title: "Para quem",
        links: [
            { label: "Clínica e salão", href: "#produto" },
            { label: "Oficina", href: "#produto" },
            { label: "Escritório", href: "#produto" },
        ],
    },
] as const;

export const ATTENDANCE_FAQ = [
    {
        q: "O cliente precisa de app?",
        a: "Não. Fala no WhatsApp da empresa.",
    },
    {
        q: "O que entra no plano?",
        a: "Agente no WhatsApp, agenda e card do serviço. Mensal a R$ 159, ou anual a R$ 99,90 por mês.",
    },
    {
        q: "Como eu começo?",
        a: "Chama no WhatsApp. A gente abre a conta neste plano.",
    },
    {
        q: "O que é o Enterprise?",
        a: "Não tem preço de tabela. A empresa chama e o plano é montado para a operação.",
    },
    {
        q: "E se eu vendo delivery?",
        a: "Delivery é outro produto, com outra tabela. A página dele continua em Delivery.",
    },
] as const;

const TALK = {
    month: "Quero o Office mensal, R$ 159 por mês.",
    year: "Quero o Office anual, R$ 99,90 por mês.",
    enterprise: "Quero montar um plano Enterprise do Office.",
} as const;

export type AttendanceTalk = keyof typeof TALK;

export function attendanceYearlySavingsPercent(): number {
    return yearlySavingsPercent(ATTENDANCE_MONTHLY_CENTS, ATTENDANCE_YEARLY_CENTS);
}

export function attendanceTalkHref(kind: AttendanceTalk): string {
    return `${SITE_CHAT_WHATSAPP_HREF}?text=${encodeURIComponent(TALK[kind])}`;
}
