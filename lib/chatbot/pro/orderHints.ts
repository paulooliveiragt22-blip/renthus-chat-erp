import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateCustomer } from "../db/orders";
import { resolveDefaultAddressForCustomer } from "./resolveSavedAddress";

export async function buildOrderHintsPayload(params: {
    admin:     SupabaseClient;
    companyId: string;
    phoneE164: string;
    name?:    string | null;
}): Promise<Record<string, unknown>> {
    const { admin, companyId, phoneE164, name } = params;

    const customer = await getOrCreateCustomer(admin, companyId, phoneE164, name ?? null);
    if (!customer?.id) {
        return { customer_known: false, hint: "Primeiro pedido: pergunte o endereço completo (rua, número, bairro)." };
    }

    const saved = await resolveDefaultAddressForCustomer(admin, companyId, customer.id);

    const { data: favs } = await admin.rpc("get_customer_favorites", {
        p_company_id:     companyId,
        p_customer_phone: phoneE164,
        p_limit:            5,
    });

    return {
        customer_known: true,
        customer_id:    customer.id,
        saved_address:  saved
            ? {
                ...saved.address,
                resolution: saved.note,
            }
            : null,
        favorite_lines: (favs ?? []).map((f: { id: string; name?: string; description?: string; price?: number }) => ({
            produto_embalagem_id: f.id,
            label:                f.name ?? f.description ?? "",
            price:                f.price,
        })),
    };
}
