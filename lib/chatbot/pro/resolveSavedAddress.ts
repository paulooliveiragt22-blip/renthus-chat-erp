import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiOrderAddress } from "./typesAiOrder";

export type SavedClienteEnderecoRow = {
    id:          string;
    apelido:     string | null;
    logradouro:  string | null;
    numero:      string | null;
    complemento: string | null;
    bairro:      string | null;
    cidade:      string | null;
    estado:      string | null;
    cep:         string | null;
    is_principal: boolean | null;
};

export type ResolvedSavedAddress = {
    address: AiOrderAddress;
    /** ex.: "principal no cadastro" | "último pedido entregue" */
    note: string;
};

/** Todos os endereços cadastrados do cliente (para hints / IA mostrar antes de pedir novo). */
export async function listCustomerAddressesForCustomer(
    admin: SupabaseClient,
    companyId: string,
    customerId: string
): Promise<SavedClienteEnderecoRow[]> {
    const { data } = await admin
        .from("enderecos_cliente")
        .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep, is_principal")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .order("is_principal", { ascending: false })
        .order("apelido", { ascending: true });
    return (data ?? []) as SavedClienteEnderecoRow[];
}

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
        .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .eq("is_principal", true)
        .maybeSingle();

    if (principal?.logradouro && principal?.numero && principal?.bairro) {
        return {
            address: {
                logradouro:           String(principal.logradouro).trim(),
                numero:               String(principal.numero ?? "").trim(),
                bairro:               String(principal.bairro).trim(),
                complemento:          principal.complemento ? String(principal.complemento).trim() : null,
                apelido:              principal.apelido ? String(principal.apelido).trim() : null,
                cidade:               principal.cidade ? String(principal.cidade).trim() : null,
                estado:               principal.estado ? String(principal.estado).trim() : null,
                cep:                  principal.cep ? String(principal.cep).trim() : null,
                endereco_cliente_id:  principal.id as string,
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
        .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep")
        .eq("id", addrId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (fromOrder?.logradouro && fromOrder?.numero && fromOrder?.bairro) {
        return {
            address: {
                logradouro:           String(fromOrder.logradouro).trim(),
                numero:               String(fromOrder.numero ?? "").trim(),
                bairro:               String(fromOrder.bairro).trim(),
                complemento:          fromOrder.complemento ? String(fromOrder.complemento).trim() : null,
                apelido:              fromOrder.apelido ? String(fromOrder.apelido).trim() : null,
                cidade:               fromOrder.cidade ? String(fromOrder.cidade).trim() : null,
                estado:               fromOrder.estado ? String(fromOrder.estado).trim() : null,
                cep:                  fromOrder.cep ? String(fromOrder.cep).trim() : null,
                endereco_cliente_id:  fromOrder.id as string,
            },
            note: "último endereço usado num pedido entregue",
        };
    }

    return null;
}
