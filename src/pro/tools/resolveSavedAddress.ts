import type { SupabaseClient } from "@supabase/supabase-js";
import { tryParseAddressOneLine } from "./parseAddressLoosePt";
import type { DraftAddress } from "@/src/types/contracts";

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
    address: DraftAddress;
    /** ex.: "principal no cadastro" | "último pedido entregue" */
    note: string;
};

/**
 * Monta `DraftAddress` a partir de `enderecos_cliente`.
 * Se `numero`/`bairro` vierem vazios mas `logradouro` for uma linha única (ex.: "Rua X 34 Bairro"),
 * usa `tryParseAddressOneLine` para o draft e slots passarem em `isAddressStructurallyComplete`.
 */
export function buildAiAddressFromSavedClienteRow(row: SavedClienteEnderecoRow): DraftAddress | null {
    const rawLog = row.logradouro?.replace(/\s+/gu, " ").trim() ?? "";
    if (!rawLog) return null;
    let logradouro = rawLog;
    let numero = row.numero?.replace(/\s+/gu, " ").trim() ?? "";
    let bairro = row.bairro?.replace(/\s+/gu, " ").trim() ?? "";
    if (!numero || !bairro) {
        const parsed = tryParseAddressOneLine(rawLog);
        if (parsed) {
            logradouro = parsed.logradouro;
            numero = parsed.numero;
            bairro = parsed.bairro;
        }
    }
    if (!logradouro || !numero || !bairro) return null;
    const cidade = row.cidade ? String(row.cidade).trim() : "";
    const estado = row.estado ? String(row.estado).trim().toUpperCase().slice(0, 2) : "";
    if (!cidade || estado.length !== 2) return null;
    return {
        logradouro,
        numero,
        bairro,
        complemento: row.complemento ? String(row.complemento).trim() : null,
        apelido: row.apelido ? String(row.apelido).trim() : null,
        cidade,
        estado,
        cep: row.cep ? String(row.cep).trim() : null,
        enderecoClienteId: row.id as string,
    };
}

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

    if (principal?.logradouro) {
        const address = buildAiAddressFromSavedClienteRow(principal as SavedClienteEnderecoRow);
        if (address) return { address, note: "endereço principal do cadastro" };
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

    if (fromOrder?.logradouro) {
        const address = buildAiAddressFromSavedClienteRow(fromOrder as SavedClienteEnderecoRow);
        if (address) return { address, note: "último endereço usado num pedido entregue" };
    }

    return null;
}

export type AddressDeliveryStat = {
    address: SavedClienteEnderecoRow;
    deliveryCount: number;
    /** ISO timestamp do pedido mais recente entregue/finalizado neste endereço, se houver. */
    lastDeliveredAt: string | null;
};

/**
 * Para cada endereço cadastrado do cliente, conta quantos pedidos entregues/finalizados
 * usaram esse endereço (`orders.delivery_endereco_cliente_id`) e a data do mais recente.
 * Não há coluna de contagem em `enderecos_cliente` — é agregado aqui a partir de `orders`.
 */
export async function rankCustomerAddressesByDelivery(
    admin: SupabaseClient,
    companyId: string,
    customerId: string
): Promise<AddressDeliveryStat[]> {
    const addresses = await listCustomerAddressesForCustomer(admin, companyId, customerId);
    if (!addresses.length) return [];

    const { data: orders, error } = await admin
        .from("orders")
        .select("delivery_endereco_cliente_id, created_at")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .in("status", ["delivered", "finalized"])
        .not("delivery_endereco_cliente_id", "is", null);
    if (error) {
        console.warn("[rankCustomerAddressesByDelivery]", error.message);
    }

    const countByAddr = new Map<string, number>();
    const lastByAddr = new Map<string, string>();
    for (const row of orders ?? []) {
        const id = String(
            (row as { delivery_endereco_cliente_id?: string | null }).delivery_endereco_cliente_id ?? ""
        );
        if (!id) continue;
        countByAddr.set(id, (countByAddr.get(id) ?? 0) + 1);
        const createdAt = String((row as { created_at?: string | null }).created_at ?? "");
        if (createdAt && createdAt > (lastByAddr.get(id) ?? "")) {
            lastByAddr.set(id, createdAt);
        }
    }

    return addresses.map((address) => ({
        address,
        deliveryCount: countByAddr.get(address.id) ?? 0,
        lastDeliveredAt: lastByAddr.get(address.id) ?? null,
    }));
}
