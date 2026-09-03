/**
 * Política de canal de checkout pós-itens (ADR-0005 R1–R2 / C1b).
 * Puro — sem I/O. O servidor decide WA vs cardápio web; a IA não escolhe o canal.
 */

import type { FulfillmentType } from "@/lib/delivery/fulfillment";

export type CheckoutChannelDecision =
    | {
          channel: "whatsapp";
          reason:
              | "no_items"
              | "awaiting_fulfillment"
              | "pickup"
              | "saved_address_ok"
              | "address_complete_on_wa";
      }
    | {
          channel: "web_menu";
          reason: "no_saved_address" | "incomplete_saved_address" | "new_address_requested";
      };

export type ResolveCheckoutChannelInput = {
    hasItems: boolean;
    /** `null`/ausente = cliente ainda não escolheu Entrega/Retirada. */
    fulfillmentType: FulfillmentType | null | undefined;
    /** Draft já tem rua+número+bairro+cidade+UF. */
    addressStructurallyComplete: boolean;
    /**
     * De `orderHints.requires_address_flow_registration`:
     * zero endereços salvos **ou** há cadastro incompleto.
     */
    requiresAddressRegistration: boolean;
    /** Há endereços salvos mas pelo menos um incompleto (hint opcional p/ reason). */
    hasIncompleteSavedAddress?: boolean;
    /** Cliente pediu “outro endereço” / `pro_new_address_flow` / `pro_edit_delivery_address`. */
    intentNewAddress: boolean;
};

/**
 * R2: WA default com endereço utilizável; web só outro/incompleto/sem cadastro.
 * R1: só faz sentido após itens; sem fulfillment ainda → fica no WA (botões Entrega/Retirada).
 */
export function resolveCheckoutChannel(
    input: ResolveCheckoutChannelInput
): CheckoutChannelDecision {
    if (!input.hasItems) {
        return { channel: "whatsapp", reason: "no_items" };
    }

    const ft = input.fulfillmentType ?? null;
    if (ft !== "delivery" && ft !== "pickup") {
        return { channel: "whatsapp", reason: "awaiting_fulfillment" };
    }

    if (ft === "pickup") {
        return { channel: "whatsapp", reason: "pickup" };
    }

    // delivery
    if (input.intentNewAddress) {
        return { channel: "web_menu", reason: "new_address_requested" };
    }

    if (input.requiresAddressRegistration) {
        if (input.hasIncompleteSavedAddress) {
            return { channel: "web_menu", reason: "incomplete_saved_address" };
        }
        return { channel: "web_menu", reason: "no_saved_address" };
    }

    if (input.addressStructurallyComplete) {
        return { channel: "whatsapp", reason: "address_complete_on_wa" };
    }

    // Tem endereço(s) salvos completos mas ainda não no draft — escolha no WA.
    return { channel: "whatsapp", reason: "saved_address_ok" };
}

/** CTA de cadastro no cardápio quando a decision é web_menu. */
export function shouldOfferWebAddressHandoff(
    decision: CheckoutChannelDecision
): boolean {
    return decision.channel === "web_menu";
}
