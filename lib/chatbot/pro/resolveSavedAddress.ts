import type { SupabaseClient } from "@supabase/supabase-js";
import { tryParseAddressOneLine } from "./parseAddressLoosePt";
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

/**
 * Monta `AiOrderAddress` a partir de `enderecos_cliente`.
 * Se `numero`/`bairro` vierem vazios mas `logradouro` for uma linha única (ex.: "Rua X 34 Bairro"),
 * usa `tryParseAddressOneLine` para o draft e slots passarem em `isAddressStructurallyComplete`.
 */
export function buildAiAddressFromSavedClienteRow(row: SavedClienteEnderecoRow): AiOrderAddress | null {
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
    return {
        logradouro,
        numero,
        bairro,
        complemento: row.complemento ? String(row.complemento).trim() : null,
        apelido: row.apelido ? String(row.apelido).trim() : null,
        cidade: row.cidade ? String(row.cidade).trim() : null,
        estado: row.estado ? String(row.estado).trim() : null,
        cep: row.cep ? String(row.cep).trim() : null,
        endereco_cliente_id: row.id as string,
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
