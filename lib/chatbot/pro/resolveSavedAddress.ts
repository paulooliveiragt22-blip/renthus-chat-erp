import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiOrderAddress } from "./typesAiOrder";

export type ResolvedSavedAddress = {
    address: AiOrderAddress;
    /** ex.: "principal no cadastro" | "último pedido entregue" */
    note: string;
};

/**
 * Prioridade: endereço principal em `enderecos_cliente` → último pedido com FK
 * `delivery_endereco_cliente_id` → nada.
 */
export async function resolveDefaultAddressForCustomer(
    admin: SupabaseClient,
    companyId: string,
    customerId: string
): Promise<ResolvedSavedAddress | null> {
    const { data: principal } = await admin
        .from("enderecos_cliente")
        .select("id, apelido, logradouro, numero, complemento, bairro")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .eq("is_principal", true)
        .maybeSingle();

    if (principal?.logradouro && principal?.numero && principal?.bairro) {
        return {
            address: {
                logradouro:  String(principal.logradouro).trim(),
                numero:      String(principal.numero ?? "").trim(),
                bairro:      String(principal.bairro).trim(),
                complemento: principal.complemento ? String(principal.complemento).trim() : null,
                apelido:     principal.apelido ? String(principal.apelido).trim() : null,
            },
            note: "endereço principal do cadastro",
        };
    }

    const { data: lastOrder } = await admin
        .from("orders")
        .select("delivery_endereco_cliente_id")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .in("status", ["delivered", "finalized"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const addrId = lastOrder?.delivery_endereco_cliente_id as string | undefined;
    if (!addrId) return null;

    const { data: fromOrder } = await admin
        .from("enderecos_cliente")
        .select("apelido, logradouro, numero, complemento, bairro")
        .eq("id", addrId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (fromOrder?.logradouro && fromOrder?.numero && fromOrder?.bairro) {
        return {
            address: {
                logradouro:  String(fromOrder.logradouro).trim(),
                numero:      String(fromOrder.numero ?? "").trim(),
                bairro:      String(fromOrder.bairro).trim(),
                complemento: fromOrder.complemento ? String(fromOrder.complemento).trim() : null,
                apelido:     fromOrder.apelido ? String(fromOrder.apelido).trim() : null,
            },
            note: "último endereço usado num pedido entregue",
        };
    }

    return null;
}
