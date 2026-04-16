import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateCustomer } from "../db/orders";
import { listCustomerAddressesForCustomer, resolveDefaultAddressForCustomer } from "./resolveSavedAddress";

const FLOW_REMINDER_PT =
    "Fluxo sugerido: (1) get_order_hints cedo no pedido; (2) search_produtos antes de citar preço; " +
    "(3) prepare_order_draft pode ser chamado várias vezes até ok:true — use só produto_embalagem_id retornados pelo search.";

export async function buildOrderHintsPayload(params: {
    admin:     SupabaseClient;
    companyId: string;
    phoneE164: string;
    name?:    string | null;
}): Promise<Record<string, unknown>> {
    const { admin, companyId, phoneE164, name } = params;

    const customer = await getOrCreateCustomer(admin, companyId, phoneE164, name ?? null);
    if (!customer?.id) {
        return {
            flow_reminder_pt: FLOW_REMINDER_PT,
            customer_known: false,
            hint:
                "Primeiro pedido: antes de pedir endereço, confira se saved_addresses veio vazio. Se vazio, peça logradouro, número, bairro e (se possível) cidade/CEP em campos separados.",
        };
    }

    const saved = await resolveDefaultAddressForCustomer(admin, companyId, customer.id);
    const savedList = await listCustomerAddressesForCustomer(admin, companyId, customer.id);

    const { data: favs } = await admin.rpc("get_customer_favorites", {
        p_company_id:     companyId,
        p_customer_phone: phoneE164,
        p_limit:            5,
    });

    return {
        /** Lembrete fixo para o modelo: ordem de tools e reaproveitamento de draft. */
        flow_reminder_pt: FLOW_REMINDER_PT,
        customer_known: true,
        customer_id:    customer.id,
        saved_address:  saved
            ? {
                ...saved.address,
                resolution: saved.note,
            }
            : null,
        /** Liste todos ao cliente antes de pedir um endereço novo; use `saved_address_id` no prepare_order_draft para um destes ids. */
        saved_addresses: savedList.map((r) => ({
            id:           r.id,
            apelido:      r.apelido,
            logradouro:   r.logradouro,
            numero:       r.numero,
            complemento:  r.complemento,
            bairro:       r.bairro,
            cidade:       r.cidade,
            estado:       r.estado,
            cep:          r.cep,
            is_principal: r.is_principal,
        })),
        favorite_lines: (favs ?? []).map((f: { id: string; name?: string; description?: string; price?: number }) => ({
            produto_embalagem_id: f.id,
            label:                f.name ?? f.description ?? "",
            price:                f.price,
        })),
    };
}
