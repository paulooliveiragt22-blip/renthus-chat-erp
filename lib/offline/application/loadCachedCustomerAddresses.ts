/**
 * Endereços de cliente no snapshot offline (domain customer_addresses).
 */

import type { SavedCustomerAddress } from "@/lib/orders/types";
import { loadAdminListSnapshotEntries } from "../browserStores";

export type CachedCustomerAddress = SavedCustomerAddress & {
    customer_id: string;
};

export function filterAddressesForCustomer(
    all: CachedCustomerAddress[],
    customerId: string
): SavedCustomerAddress[] {
    return all
        .filter((a) => a.customer_id === customerId && a.id)
        .map((a) => ({
            id: String(a.id),
            apelido: String(a.apelido ?? "Entrega"),
            logradouro: a.logradouro ?? null,
            numero: a.numero ?? null,
            complemento: a.complemento ?? null,
            bairro: a.bairro ?? null,
            cidade: a.cidade ?? null,
            estado: a.estado ?? null,
            cep: a.cep ?? null,
            is_principal: Boolean(a.is_principal),
        }))
        .sort((a, b) => Number(b.is_principal) - Number(a.is_principal));
}

export async function loadCachedAddressesForCustomer(
    companyId: string,
    customerId: string
): Promise<SavedCustomerAddress[]> {
    const all = await loadAdminListSnapshotEntries<CachedCustomerAddress>(
        companyId,
        "customer_addresses"
    );
    return filterAddressesForCustomer(all, customerId);
}
