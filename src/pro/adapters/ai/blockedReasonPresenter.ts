import type { PrepareOrderDraftBlockedReason } from "@/src/pro/ports/orderDraft.port";

function formatBrl(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

/**
 * Instrução (guidance_for_model_pt) por motivo tipado de bloqueio de `prepare_order_draft`.
 * Casos com causa única e conhecida (item faltando, endereço, mínimo, pagamento, troco) —
 * o catálogo dinâmico de erros por item/estoque/UUID continua em `errors: string[]`
 * e é tratado separadamente em `buildPrepareDraftGuidanceForModel` (código `FIX_ERRORS`).
 */
export function presentBlockedReasonForModel(reason: PrepareOrderDraftBlockedReason): string[] {
    switch (reason.code) {
        case "MISSING_ITEMS":
            return ["Inclua items com produto_embalagem_id do último search_produtos."];

        case "ADDRESS_INCOMPLETE":
            return [
                "Há rascunho parcial com itens no servidor.",
                "Não diga erro técnico. Peça ou confirme o endereço (rua, número, bairro, cidade, UF) ou use saved_address_id.",
                "Depois chame prepare_order_draft de novo.",
            ];

        case "OUT_OF_DELIVERY_ZONE":
            return [
                `O bairro "${reason.neighborhood}" está fora da área de entrega.`,
                "Informe isso ao cliente com uma frase e peça outro endereço dentro da região atendida.",
            ];

        case "BELOW_MIN_ORDER":
            return [
                `Rascunho parcial com itens no servidor, mas o total ainda está R$ ${formatBrl(reason.missing)} abaixo do pedido mínimo (R$ ${formatBrl(reason.minOrder)}).`,
                "Explique o valor mínimo e o quanto falta, e sugira acrescentar itens (pode citar favoritos de get_order_hints) até atingir o valor.",
                "NÃO pergunte forma de pagamento nem peça confirmação final enquanto o mínimo não for atingido — o servidor só oferece os botões de pagamento depois disso.",
            ];

        case "PAYMENT_MISSING":
            return [
                "Há rascunho parcial com itens (e talvez endereço) no servidor.",
                "Pergunte PIX, cartão ou dinheiro e chame prepare_order_draft com payment_method.",
                "NÃO peça confirmação final do pedido ainda.",
            ];

        case "INVALID_CHANGE_FOR":
            return [
                `O troco informado (R$ ${formatBrl(reason.changeFor)}) é menor que o total do pedido (R$ ${formatBrl(reason.grandTotal)}).`,
                "Peça o valor correto de troco ao cliente (tem que ser maior ou igual ao total) e chame prepare_order_draft de novo com change_for corrigido, ou confirme que é sem troco.",
            ];

        case "FIX_ERRORS":
            return [];
    }
}
