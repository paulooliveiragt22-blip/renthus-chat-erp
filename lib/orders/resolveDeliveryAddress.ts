/**
 * Resolve texto de entrega a partir do modo do formulário (online ou offline).
 * Offline: modo "new" vira linha de texto — não persiste em enderecos_cliente.
 */

import { formatEnderecoLine } from "@/lib/orders/helpers";
import type {
    NewOrderAddrForm,
    OrderAddressMode,
    SavedCustomerAddress,
} from "@/lib/orders/types";

export type ResolveDeliveryAddressResult =
    | { ok: true; address: string }
    | { ok: false; error: string };

export function resolveDeliveryAddress(input: {
    isPickup: boolean;
    mode: OrderAddressMode;
    freeText: string;
    selectedAddrId: string | null;
    saved: SavedCustomerAddress[];
    newForm: NewOrderAddrForm;
}): ResolveDeliveryAddressResult {
    if (input.isPickup) return { ok: true, address: "" };

    if (input.mode === "saved") {
        if (input.saved.length === 0) {
            return {
                ok: false,
                error:
                    "Este cliente não tem endereço salvo. Escolha “Salvar novo endereço” ou “Texto livre”.",
            };
        }
        if (!input.selectedAddrId) {
            return { ok: false, error: "Selecione um endereço salvo." };
        }
        const e = input.saved.find((a) => a.id === input.selectedAddrId);
        if (!e) {
            return { ok: false, error: "Endereço selecionado não encontrado." };
        }
        return { ok: true, address: formatEnderecoLine(e) };
    }

    if (input.mode === "new") {
        if (!input.newForm.logradouro?.trim()) {
            return { ok: false, error: "Informe o logradouro do novo endereço." };
        }
        return { ok: true, address: formatEnderecoLine(input.newForm) };
    }

    const free = input.freeText.trim();
    if (!free) {
        return { ok: false, error: "Informe o endereço de entrega." };
    }
    return { ok: true, address: free };
}
