import type { CommercialPlanKey } from "@/lib/billing/planCatalog";

export type PlanFeatureRow =
    | { kind: "item"; label: string; ai?: boolean }
    | { kind: "plus" };

export const PLAN_CARD_PITCH: Record<CommercialPlanKey, string> = {
    essencial: "Pra quem precisa parar de anotar pedido no Zap e ter um cardápio decente.",
    pro: "Pra quem já vende todo dia e precisa que o pedido vire comanda, estoque e caixa — sem retrabalho.",
    market: "Pra operação com equipe no mesmo horário, mesa e os apps de delivery ao lado do canal próprio.",
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
    title: "O cliente pede no WhatsApp. A comanda sai, o estoque baixa, o caixa fecha.",
    subtitle:
        "Feito pra adega, distribuidora e loja de bebida: agente de IA no número da loja, cardápio no navegador e PDV no balcão. Sem app pra baixar e sem comissão por pedido.",
} as const;

export const PAINS = [
    {
        title: "O pedido mora na conversa",
        body: "Alguém anota no Zap, outro confere, e o item sai errado no meio do movimento.",
    },
    {
        title: "O app fica com uma fatia",
        body: "Na entrega da própria loja, a referência pública de 2026 fica entre 14% e 15% de cada pedido pago no aplicativo, mais a mensalidade.",
    },
    {
        title: "O cliente é do aplicativo",
        body: "Ele vê o concorrente do lado e o cupom do app. No seu WhatsApp, a próxima compra começa com você.",
    },
] as const;

export const HOW_STEPS = [
    "Cadastra o que vende, com preço de unidade e de caixa, e publica o cardápio.",
    "O cliente pede no WhatsApp ou abre o cardápio no link. O agente monta o pedido.",
    "Você confirma e manda sair. No Pro, a comanda imprime, o estoque baixa e o valor entra no financeiro.",
] as const;

export const PRODUCT_BLOCKS = [
    {
        title: "Agente no WhatsApp da loja",
        body: "O cliente pede no número que já tem salvo. O agente monta unidade, caixa ou fardo, endereço e pagamento. O WhatsApp Business continua no celular.",
    },
    {
        title: "Cardápio web no link",
        body: "Quem não quer conversar abre o cardápio no navegador, pelo status, pela bio ou pelo Google. Sem baixar aplicativo. O pedido cai no mesmo painel.",
    },
    {
        title: "PDV no balcão",
        body: "Venda no balcão com pagamento misto. A prazo só com cliente identificado e dentro do limite de crédito.",
    },
    {
        title: "No Pro, o pedido não para na tela",
        body: "A comanda imprime, o estoque baixa pela embalagem vendida e o valor entra no financeiro. Campanha no WhatsApp volta para quem já pediu.",
    },
] as const;

/** Bônus do plano anual (Pro e Market). */
export const ANNUAL_LEAFLETS =
    "Bônus Anual: 1.000 panfletos prontos para colar na sacola e migrar seus clientes do iFood para o seu WhatsApp.";

/** @deprecated Use ANNUAL_LEAFLETS */
export const PRO_ANNUAL_LEAFLETS = ANNUAL_LEAFLETS;

export const PLAN_GUARANTEE =
    "Garantia incondicional de 7 dias: teste na sua operação ou devolvemos 100% do valor.";

export const HERO_RISK =
    "Sem fidelidade · Cancele em 1 clique · Configuração em 15 minutos · Garantia de 7 dias";

export const FAQ_ITEMS = [
    {
        q: "Preciso falar com vendedor pra começar?",
        a: "Não. Escolhe o plano, cria a conta, paga e começa a configurar. Em cerca de 15 minutos dá pra cadastrar produtos, publicar o cardápio e conectar o WhatsApp.",
    },
    {
        q: "Paga e usa de verdade? Tem teste grátis?",
        a: "O comercial padrão é pagar e usar. Se a política da conta estiver com teste, a própria página dos planos mostra. Em qualquer caso, há garantia incondicional de 7 dias: se não servir na sua operação, devolvemos 100% do valor.",
    },
    {
        q: "Quanto custa a IA além da mensalidade?",
        a: "A mensalidade do plano inclui uma cota de uso de IA. Se a loja estourar a cota, dá pra recarregar crédito de IA no painel. O agente só responde quando há crédito disponível.",
    },
    {
        q: "O que eu preciso pra conectar o WhatsApp?",
        a: "Uma conta WhatsApp Business da loja e um QR Code no painel. Você escaneia uma vez; depois o agente roda na nuvem, mesmo com o celular desligado.",
    },
    {
        q: "Funciona no celular?",
        a: "Sim. Painel e PDV abrem no celular ou no computador.",
    },
    {
        q: "Imprime comanda?",
        a: "No Pro e no Market o pedido vai direto pra impressora com o agent de impressão.",
    },
    {
        q: "O cliente precisa baixar app?",
        a: "Não. Abre o cardápio no navegador ou pede no WhatsApp.",
    },
    {
        q: "E o iFood, o Aiqfome e o 99Food?",
        a: "Servem para cliente que ainda não te conhece. Quem já comprou pode pedir no seu WhatsApp e no cardápio, sem comissão por venda. A conta desta página usa taxas públicas de entrega da própria loja e pode ser diferente do contrato da sua cidade.",
    },
    {
        q: "O anual inclui panfleto?",
        a: "Sim, no Pro e no Market anual. São 1.000 panfletos para colar na sacola e levar o cliente do aplicativo para o WhatsApp da loja.",
    },
    {
        q: "E se o cliente mandar áudio no WhatsApp, o agente entende?",
        a: "Sim. O agente transcreve e entende áudios naturalmente, identificando produtos, quantidades (unidade, caixa ou fardo), endereço e forma de pagamento.",
    },
    {
        q: "Meu número corre risco de ser banido pelo WhatsApp?",
        a: "Não. O agente responde apenas clientes que chamam a sua loja primeiro e segue as boas práticas de envio para campanhas, mantendo a segurança do seu número.",
    },
    {
        q: "Como funciona o cálculo da taxa de entrega?",
        a: "Você cadastra suas taxas por bairro ou raio de distância (km). O agente calcula o frete automaticamente antes de fechar o pedido.",
    },
    {
        q: "Preciso deixar um celular exclusivo ligado na loja?",
        a: "Não. Depois de conectar o QR Code uma única vez, o agente funciona na nuvem 24 horas por dia, mesmo se o celular da loja ficar sem bateria ou desligado.",
    },
    {
        q: "E se a IA ficar indisponível?",
        a: "O cliente recebe um aviso e o link do cardápio web para pedir sem depender da conversa. Pedidos pelo cardápio e pelo PDV continuam no mesmo painel.",
    },
    {
        q: "Dá pra mais de uma pessoa usar?",
        a: "Essencial e Pro: 1 usuário. Market: 10. No Pro e no Market dá pra adicionar gente extra (R$ 99/mês).",
    },
] as const;
