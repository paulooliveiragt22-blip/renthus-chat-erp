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
        "Agente de IA no número da loja, cardápio no navegador e PDV no balcão. O cliente não baixa app e você não paga comissão por pedido.",
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

export const LOYALTY = [
    {
        title: "A conversa fica sua",
        body: "No app, o próximo pedido nasce de um cupom do marketplace, ao lado do concorrente. No WhatsApp, o histórico é da loja.",
    },
    {
        title: "Quem já comprou recebe de novo",
        body: "No Pro, template e campanha saem no número que o cliente já salvou. Sem pagar mídia para falar com a própria clientela.",
    },
    {
        title: "O cardápio é um link",
        body: "O mesmo catálogo do agente abre no navegador. A pessoa monta o pedido, escolhe a embalagem e confirma. O pedido entra na fila junto com o do WhatsApp.",
    },
] as const;

export const PRO_ANNUAL_LEAFLETS =
    "Bônus anual: 1.000 panfletos prontos para colar na sacola e migrar seus clientes do iFood para o seu WhatsApp.";

export const PLAN_GUARANTEE =
    "Garantia de 7 dias: teste na sua operação ou devolvemos 100% do valor.";

export const HERO_RISK =
    "Sem fidelidade · Cancele em 1 clique · Configuração em 15 minutos";

export const TRUST_METRICS = [
    { value: "+15.000", label: "pedidos fechados sem erro" },
    { value: "99,4%", label: "de precisão na montagem de caixas e unidades" },
    { value: "4 segundos", label: "tempo médio de resposta" },
] as const;

export const TESTIMONIALS = [
    {
        name: "Marina Alves",
        store: "Adega do Centro",
        city: "Campinas",
        initials: "MA",
        quote: "Eu travava na hora de soltar a IA no Zap com medo de sair caixa no lugar de unidade. Ela confirma a embalagem antes de fechar, e a comanda chega certa na impressora.",
    },
    {
        name: "Ricardo Souza",
        store: "Distribuidora Rio Branco",
        city: "Fortaleza",
        initials: "RS",
        quote: "No aplicativo a taxa comia o pedido grande de caixa. No nosso número a mensalidade é fixa, e quem já compra toda semana pede direto com a gente.",
    },
    {
        name: "Paula Nunes",
        store: "Lanchonete da Praça",
        city: "Porto Alegre",
        initials: "PN",
        quote: "O cliente manda o pedido do jeito que fala. O agente separa unidade e combo, o estoque baixa e eu não fico relendo a conversa no meio do almoço.",
    },
] as const;

export const FAQ_ITEMS = [
    {
        q: "Preciso falar com vendedor pra começar?",
        a: "Não. Escolhe o plano, cria a conta e paga.",
    },
    {
        q: "Funciona no celular?",
        a: "Sim. Celular ou computador.",
    },
    {
        q: "Imprime comanda?",
        a: "No Pro e no Market o pedido vai direto pra impressora.",
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
        q: "O Pro anual inclui panfleto?",
        a: "Sim. São 1.000 panfletos para colar na sacola e levar o cliente do aplicativo para o WhatsApp da loja.",
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
        q: "Dá pra mais de uma pessoa usar?",
        a: "Essencial e Pro: 1 usuário. Market: 10. No Pro e no Market dá pra adicionar gente extra (R$ 99/mês).",
    },
] as const;
