/**
 * Copy PT-BR amigável para checkout do cardápio (modo único + pedido mínimo).
 * Sem tom de erro — callouts convidativos.
 */

import type { FulfillmentType } from "@/lib/delivery/fulfillment";

export function formatMenuMoneyBRL(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type SoleFulfillmentNotice = {
    type: FulfillmentType;
    title: string;
    body: string;
    cta: string;
};

/** Aviso quando a loja só aceita um modo. */
export function soleFulfillmentNotice(type: FulfillmentType): SoleFulfillmentNotice {
    if (type === "pickup") {
        return {
            type: "pickup",
            title: "Hoje é só retirada no local",
            body: "No momento não estamos fazendo entregas. Você pode montar o pedido e retirar na loja — sem taxa de entrega.",
            cta: "Continuar para pagamento",
        };
    }
    return {
        type: "delivery",
        title: "Só estamos entregando",
        body: "A retirada no local está pausada por agora. Informe o endereço e a gente leva até você.",
        cta: "Informar endereço",
    };
}

export type DeliveryMinOrderHint =
    | { kind: "none" }
    | {
          kind: "below";
          title: string;
          body: string;
          minOrder: number;
          missing: number;
      };

/**
 * Tip de pedido mínimo para entrega — só quando ainda falta valor.
 * Sem CTA embutido: as ações ficam nos controles do step (Entrega / Retirar / Voltar).
 */
export function deliveryMinOrderHint(
    subtotal: number,
    minOrder: number | null | undefined
): DeliveryMinOrderHint {
    if (minOrder == null || !Number.isFinite(minOrder) || minOrder <= 0) {
        return { kind: "none" };
    }
    const min = Number(minOrder);
    const sub = Number(subtotal);
    if (!Number.isFinite(sub)) return { kind: "none" };
    if (sub + 1e-9 >= min) return { kind: "none" };

    const missing = Math.round((min - sub) * 100) / 100;
    return {
        kind: "below",
        title: "Quase lá para a entrega",
        body: `O pedido mínimo para entrega é ${formatMenuMoneyBRL(min)}. Faltam ${formatMenuMoneyBRL(missing)}.`,
        minOrder: min,
        missing,
    };
}

/** Linha curta no card “Entrega” do step de escolha. */
export function deliveryMinOrderCardLine(minOrder: number | null | undefined): string | null {
    if (minOrder == null || !Number.isFinite(minOrder) || minOrder <= 0) return null;
    return `Pedido mínimo ${formatMenuMoneyBRL(Number(minOrder))}`;
}
