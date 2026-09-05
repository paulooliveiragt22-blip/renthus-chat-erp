/** Catálogo de telas para smoke E2E — mantido alinhado ao App Router. */

export type ScreenGroup = "public" | "admin" | "billing" | "platform";

export type ScreenRoute = {
    /** Path ou pattern relativo (sem baseURL). */
    path: string;
    name: string;
    group: ScreenGroup;
    /** Texto/regex que indica render ok (opcional — usa heurística genérica). */
    expectText?: RegExp;
    /** URLs finais aceitas além do path (paywall, redirect). */
    allowedRedirects?: RegExp[];
    /** Rota dinâmica — resolver em runtime (ex.: product id). */
    dynamic?: "product-images" | "platform-company" | "catalog-slug";
    /** Só roda se env presente. */
    requiresEnv?: string;
};

export const PUBLIC_SCREENS: ScreenRoute[] = [
    { path: "/login", name: "Login", group: "public", expectText: /entrar|login|e-mail/i },
    { path: "/signup", name: "Cadastro", group: "public", expectText: /crie sua conta|quero este plano|essencial/i },
    { path: "/onboarding", name: "Onboarding público", group: "public", expectText: /ativ|renthus|whatsapp/i },
    { path: "/logout", name: "Logout", group: "public" },
    { path: "/offline", name: "Offline PWA", group: "public", expectText: /offline|conexão|internet/i },
    {
        path: "/auth/set-password",
        name: "Definir senha",
        group: "public",
        expectText: /senha|password|definir/i,
    },
];

export const BILLING_SCREENS: ScreenRoute[] = [
    {
        path: "/plano/pagar",
        name: "Checkout inicial",
        group: "billing",
        expectText: /pagamento|plano|pix|cartão/i,
        allowedRedirects: [/\/plano(?:\?|$)/, /\/ativar/, /\/dashboard/, /\/login/],
    },
    {
        path: "/plano/bloqueado",
        name: "Plano bloqueado",
        group: "billing",
        expectText: /bloquead|assinatura|pagamento/i,
        allowedRedirects: [/\/plano(?:\?|$)/, /\/dashboard/, /\/login/],
    },
    {
        path: "/plano/reativar",
        name: "Reativar loja",
        group: "billing",
        expectText: /reativar|assinatura|trial/i,
        allowedRedirects: [/\/plano(?:\?|$)/, /\/dashboard/, /\/login/],
    },
    {
        path: "/billing/blocked",
        name: "Billing blocked",
        group: "billing",
        expectText: /bloquead|pagamento|plano/i,
        allowedRedirects: [/\/plano/, /\/login/],
    },
    {
        path: "/billing/checkout-success",
        name: "Checkout success",
        group: "billing",
        expectText: /sucesso|confirmad|pagamento/i,
    },
];

/** Rotas do AdminSidebar + extras operacionais. */
export const ADMIN_SCREENS: ScreenRoute[] = [
    { path: "/", name: "Home", group: "admin", expectText: /dashboard|hoje|pedidos|vendas|faturamento/i, allowedRedirects: [/\/dashboard/, /\/pedidos/, /\/login/] },
    { path: "/dashboard", name: "Dashboard", group: "admin", expectText: /dashboard|hoje|pedidos|vendas|faturamento/i },
    { path: "/pedidos", name: "Pedidos", group: "admin", expectText: /pedidos|preparo|entrega/i },
    { path: "/fila", name: "Fila", group: "admin", expectText: /fila|pedidos|confirm/i },
    { path: "/pdv", name: "PDV", group: "admin", expectText: /pdv|balcão|buscar|produto/i },
    { path: "/mesa", name: "Mesas", group: "admin", expectText: /mesa|comanda|salão/i },
    { path: "/whatsapp", name: "WhatsApp", group: "admin", expectText: /whatsapp|conversa|chat/i },
    { path: "/templates", name: "Templates WA", group: "admin", expectText: /template|whatsapp|modelo/i },
    { path: "/campanhas", name: "Campanhas", group: "admin", expectText: /campanha|disparo|broadcast/i },
    { path: "/produtos/lista", name: "Produtos lista", group: "admin", expectText: /produtos|cadastr|lista/i },
    {
        path: "/produtos",
        name: "Produtos redirect",
        group: "admin",
        allowedRedirects: [/\/produtos\/lista/, /\/login/],
    },
    { path: "/clientes", name: "Clientes", group: "admin", expectText: /clientes|cadastr|telefone/i },
    { path: "/entregadores", name: "Entregadores", group: "admin", expectText: /entregador|motoboy|delivery/i },
    { path: "/estoque", name: "Estoque", group: "admin", expectText: /estoque|entrada|saída|ajuste/i },
    { path: "/financeiro", name: "Financeiro", group: "admin", expectText: /financeiro|receita|despesa|extrato/i },
    { path: "/relatorios", name: "Relatórios", group: "admin", expectText: /relatório|pedidos|faturamento/i },
    { path: "/impressoras", name: "Impressoras", group: "admin", expectText: /impress|fila|agente|cozinha/i },
    { path: "/suporte", name: "Suporte", group: "admin", expectText: /suporte|ajuda|contato/i },
    { path: "/configuracoes", name: "Configurações", group: "admin", expectText: /configurações|geral|delivery/i },
    {
        path: "/configuracoes?tab=delivery",
        name: "Config Delivery",
        group: "admin",
        expectText: /delivery|entrega|horário/i,
    },
    {
        path: "/configuracoes?tab=geral",
        name: "Config Geral",
        group: "admin",
        expectText: /equipe|perfil|geral/i,
    },
    { path: "/plano", name: "Plano e pagamentos", group: "admin", expectText: /plano|pagamento|assinatura/i },
    {
        path: "/ativar",
        name: "Wizard ativar",
        group: "admin",
        expectText: /ativar|boas-vindas|configur/i,
        allowedRedirects: [/\/dashboard/, /\/pedidos/],
    },
    {
        path: "/billing",
        name: "Billing legado",
        group: "admin",
        expectText: /plano|uso|billing/i,
        allowedRedirects: [/\/configuracoes/, /\/plano/],
    },
];

export const PLATFORM_SCREENS: ScreenRoute[] = [
    {
        path: "/platform/login",
        name: "Platform login",
        group: "platform",
        expectText: /platform|entrar|login|mfa/i,
    },
    {
        path: "/platform",
        name: "Platform dashboard",
        group: "platform",
        expectText: /platform|empresas|dashboard/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/empresas",
        name: "Platform empresas",
        group: "platform",
        expectText: /empresas|company|tenant/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/billing",
        name: "Platform billing",
        group: "platform",
        expectText: /billing|assinatura|fatura/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/canais",
        name: "Platform canais",
        group: "platform",
        expectText: /canal|whatsapp|meta/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/pedidos",
        name: "Platform pedidos",
        group: "platform",
        expectText: /pedidos|order/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/observabilidade",
        name: "Platform observabilidade",
        group: "platform",
        expectText: /observ|métrica|log|trace/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/feature-flags",
        name: "Platform feature flags",
        group: "platform",
        expectText: /feature|flag/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/audit",
        name: "Platform audit",
        group: "platform",
        expectText: /audit|log|evento/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/usuarios",
        name: "Platform usuários",
        group: "platform",
        expectText: /usuário|user|admin/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/seguranca",
        name: "Platform segurança",
        group: "platform",
        expectText: /segurança|mfa|policy/i,
        allowedRedirects: [/\/platform\/login/],
        requiresEnv: "E2E_PLATFORM_EMAIL",
    },
    {
        path: "/platform/forbidden",
        name: "Platform forbidden",
        group: "platform",
        expectText: /forbidden|negado|acesso/i,
    },
];

export const CATALOG_SCREEN: ScreenRoute = {
    path: "/c/__SLUG__",
    name: "Cardápio público",
    group: "public",
    dynamic: "catalog-slug",
    expectText: /cardápio|produto|pedido|loja/i,
    requiresEnv: "E2E_CATALOG_SLUG",
};
