export type LandingLoop = {
    id: string;
    src: string;
    label: string;
    route: string;
    viewport: string;
    seconds: string;
    preload: "metadata" | "none";
    poster?: string;
    beats: readonly string[];
};

export const LANDING_LOOPS = {
    whatsapp: {
        id: "whatsapp",
        src: "/marketing/loops/whatsapp.mp4",
        label: "Agente no inbox do WhatsApp",
        route: "/whatsapp",
        viewport: "1440×900, sidebar recolhida",
        seconds: "8–12s",
        preload: "metadata",
        beats: [
            "A mensagem do cliente entra na conversa.",
            "O agente responde com itens e total.",
            "O pedido fica visível na mesma thread.",
        ],
    },
    cardapio: {
        id: "cardapio",
        src: "/marketing/loops/cardapio.mp4",
        label: "Cardápio no navegador",
        route: "/c/[slug]",
        viewport: "janela de 390×844, sem moldura de celular",
        seconds: "8–12s",
        preload: "metadata",
        beats: [
            "A lista do cardápio abre já com foto e preço.",
            "O cliente escolhe o lanche.",
            "O checkout abre e o total aparece.",
        ],
    },
    pdv: {
        id: "pdv",
        src: "/marketing/loops/pdv.mp4",
        label: "PDV com pagamento misto",
        route: "/pdv",
        viewport: "1440×900, sidebar recolhida",
        seconds: "8–12s",
        preload: "none",
        beats: [
            "A busca encontra o produto pelo nome.",
            "O item entra no cupom.",
            "PIX e dinheiro dividem o valor.",
        ],
    },
    pedidoCaixa: {
        id: "pedidoCaixa",
        src: "/marketing/loops/pedido-caixa.mp4",
        label: "Pedido, estoque e caixa",
        route: "/pedidos → /estoque → /financeiro",
        viewport: "1440×900, três cortes no mesmo arquivo",
        seconds: "10–12s",
        preload: "none",
        beats: [
            "O pedido passa a confirmado.",
            "A quantidade no estoque desce.",
            "O valor entra no caixa.",
        ],
    },
} as const satisfies Record<string, LandingLoop>;

export const LANDING_LOOP_LIST = [
    LANDING_LOOPS.whatsapp,
    LANDING_LOOPS.cardapio,
    LANDING_LOOPS.pdv,
    LANDING_LOOPS.pedidoCaixa,
] as const;

export function getLandingLoop(id: string): LandingLoop {
    const loop = LANDING_LOOP_LIST.find((item) => item.id === id);
    if (!loop) {
        throw new Error(`Loop de landpage desconhecido: ${id}`);
    }
    return loop;
}
