import type { CommercialPlanKey } from "@/lib/billing/planCatalog";

export type PlanFeatureRow =
    | { kind: "item"; label: string; ai?: boolean }
    | { kind: "plus" };

export const PLAN_CARD_PITCH: Record<CommercialPlanKey, string> = {
    essencial: "Pra começar a vender no WhatsApp e no cardápio sem anotar pedido à mão.",
    pro: "Pra quem vende todo dia: pedido vira comanda, estoque e caixa — sem retrabalho.",
    market: "Pra operação com equipe, mesa e apps de delivery no mesmo painel.",
};

export const PLAN_FEATURE_BLURBS: Record<CommercialPlanKey, PlanFeatureRow[]> = {
    essencial: [
        { kind: "item", label: "Agente IA no WhatsApp", ai: true },
        { kind: "item", label: "Cardápio web inteligente" },
        { kind: "item", label: "PDV básico pra vender no balcão" },
        { kind: "item", label: "Cadastro de produtos" },
    ],
    pro: [
        { kind: "item", label: "Agente IA no WhatsApp", ai: true },
        { kind: "item", label: "Tudo do Essencial" },
        { kind: "plus" },
        { kind: "item", label: "Cardápio web inteligente, integrado" },
        { kind: "item", label: "Agent de impressão automática" },
        { kind: "item", label: "PDV completo" },
        { kind: "item", label: "Gestão de estoque" },
        { kind: "item", label: "Controle financeiro" },
        { kind: "item", label: "Templates e campanhas no WhatsApp" },
        { kind: "item", label: "01 usuário" },
    ],
    market: [
        { kind: "item", label: "Agente IA no WhatsApp", ai: true },
        { kind: "item", label: "Tudo do Pro" },
        { kind: "plus" },
        { kind: "item", label: "10 usuários" },
        { kind: "item", label: "Mesa" },
        { kind: "item", label: "iFood e Aiqfome no mesmo painel" },
    ],
};

export const HERO = {
    lead: "Agente de IA e cardápio web",
    beforeAccent: "direto no seu",
    accent: "WhatsApp",
    subtitle:
        "Pra hamburgueria, pizzaria e delivery. Agente no WhatsApp da loja, cardápio no navegador e PDV no balcão — sem app e sem comissão por pedido.",
} as const;

export const AGENT_DEMO_WHATSAPP_HREF = `https://wa.me/556692071285?text=${encodeURIComponent("manda pra mim dois hamburguer rosseiro")}`;

export const FEATURE_CHAPTERS = [
    {
        id: "cardapio",
        loopId: "cardapio",
        kicker: "Cardápio",
        title: "O cliente pede no navegador, sem baixar app.",
        body: "Abre no link da bio, do status ou do Google. O pedido cai no mesmo painel do WhatsApp.",
    },
] as const;

export const USE_CASES = [
    { href: "#fluxo-agente", label: "O cliente pede no WhatsApp da loja", icon: "whatsapp" },
    { href: "#cardapio", label: "O cliente pede no cardápio, sem baixar app", icon: "pdv" },
] as const;

export const FOOTER_COLUMNS = [
    {
        title: "Produto",
        links: [
            { label: "Agente no WhatsApp", href: "#fluxo-agente" },
            { label: "Cardápio", href: "#cardapio" },
            { label: "Planos", href: "#planos" },
        ],
    },
    {
        title: "Operação",
        links: [
            { label: "Economia", href: "#economia" },
            { label: "Dúvidas", href: "#faq" },
        ],
    },
    {
        title: "Para quem",
        links: [
            { label: "Hamburgueria", href: "#fluxo-agente" },
            { label: "Pizzaria", href: "#fluxo-agente" },
            { label: "Delivery", href: "#cardapio" },
        ],
    },
] as const;

export const PAINS = [
    {
        title: "O pedido mora na conversa",
        body: "Alguém anota no Zap, outro confere, e o item sai errado no movimento.",
    },
    {
        title: "O app fica com uma fatia",
        body: "Na entrega da própria loja, a referência pública fica entre 14% e 15% por pedido no app, além da mensalidade.",
    },
    {
        title: "O cliente é do aplicativo",
        body: "No seu WhatsApp, a próxima compra começa com você — não com o concorrente do feed.",
    },
] as const;

/** Bônus do plano anual (Pro e Market). */
export const ANNUAL_LEAFLETS =
    "Bônus Anual: 1.000 panfletos pra colar na sacola e trazer o cliente do iFood pro seu WhatsApp.";

/** @deprecated Use ANNUAL_LEAFLETS */
export const PRO_ANNUAL_LEAFLETS = ANNUAL_LEAFLETS;

export const PLAN_GUARANTEE =
    "Garantia de 7 dias: testa na operação ou devolvemos 100%.";

export const HERO_RISK =
    "Sem fidelidade · Cancele em 1 clique · Setup em 15 min · Garantia de 7 dias";

/** FAQ enxuto — página de vendas, não blog. */
export const FAQ_ITEMS = [
    {
        q: "Preciso falar com vendedor?",
        a: "Não. Escolhe o plano, cria a conta e configura. Em cerca de 15 minutos dá pra publicar o cardápio e conectar o WhatsApp.",
    },
    {
        q: "Tem teste grátis?",
        a: "O padrão é pagar e usar, com garantia incondicional de 7 dias. Se a conta tiver teste, os planos mostram na hora.",
    },
    {
        q: "A IA cobra além da mensalidade?",
        a: "A mensalidade inclui cota de IA. Se estourar, recarrega crédito no painel.",
    },
    {
        q: "Como conecto o WhatsApp?",
        a: "WhatsApp Business da loja + QR no painel. Escaneia uma vez; o agente roda na nuvem.",
    },
    {
        q: "O cliente precisa de app?",
        a: "Não. Pede no WhatsApp ou abre o cardápio no navegador.",
    },
    {
        q: "Imprime comanda?",
        a: "No Pro e no Market, com o agent de impressão.",
    },
    {
        q: "E o iFood?",
        a: "Serve pra atrair. Quem já conhece a loja pode pedir no seu WhatsApp e no cardápio, sem comissão por venda.",
    },
    {
        q: "Dá pra mais de uma pessoa usar?",
        a: "Essencial e Pro: 1 usuário. Market: 10. Dá pra adicionar assentos extras no Pro e Market.",
    },
] as const;
