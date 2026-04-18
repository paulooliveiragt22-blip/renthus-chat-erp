import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateCustomer } from "../db/orders";
import {
    buildAiAddressFromSavedClienteRow,
    listCustomerAddressesForCustomer,
    resolveDefaultAddressForCustomer,
} from "./resolveSavedAddress";

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
            requires_address_flow_registration: true,
            address_registration_reason_pt:
                "Primeiro contato: cadastre endereco completo (rua, numero, bairro, cidade e UF) pelo formulario enviado pelo botao.",
            hint:
                "Primeiro pedido: se o canal tiver Flow de cadastro, envie-o; senao peca logradouro, numero, bairro, cidade e UF (2 letras) em campos separados; CEP opcional para preencher via ViaCEP.",
        };
    }

    const saved = await resolveDefaultAddressForCustomer(admin, companyId, customer.id);
    const savedList = await listCustomerAddressesForCustomer(admin, companyId, customer.id);

    const saved_addresses_incomplete: Array<{ id: string; reason_pt: string }> = [];
    for (const r of savedList) {
        const parsed = buildAiAddressFromSavedClienteRow(r);
        if (parsed) continue;
        if (!(r.logradouro?.trim() || r.numero?.trim() || r.bairro?.trim())) continue;
        const missingCity = !r.cidade?.trim();
        const missingUf = !r.estado?.trim() || String(r.estado).trim().length < 2;
        saved_addresses_incomplete.push({
            id: r.id,
            reason_pt: missingCity || missingUf
                ? "Cadastro sem cidade ou sem UF valida; peca ao cliente completar ou use o Flow de endereco."
                : "Cadastro com rua/número/bairro incompletos ou em formato que o servidor não separou; peça ao cliente completar ou confirme linha por linha.",
        });
    }

    const requires_address_flow_registration =
        savedList.length === 0 || saved_addresses_incomplete.length > 0;
    const address_registration_reason_pt = requires_address_flow_registration
        ? savedList.length === 0
            ? "Cliente sem enderecos cadastrados; use o Flow ou colete rua, numero, bairro, cidade e UF."
            : "Ha endereco cadastral incompleto (ex.: falta cidade ou UF); peca para completar pelo Flow ou texto estruturado."
        : null;

    const favorite_lines = await loadCustomerFavoriteLinesSafe(admin, companyId, phoneE164);

    return {
        /** Lembrete fixo para o modelo: ordem de tools e reaproveitamento de draft. */
        flow_reminder_pt: FLOW_REMINDER_PT,
        customer_known: true,
        requires_address_flow_registration,
        ...(address_registration_reason_pt
            ? { address_registration_reason_pt }
            : {}),
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
        favorite_lines,
        ...(saved_addresses_incomplete.length
            ? { saved_addresses_incomplete }
            : {}),
    };
}

type FavoriteRpcRow = { id: string; name?: string; description?: string; price?: number };

/**
 * Favoritos são opcionais: falha do RPC (ex. 400 em produção) não deve quebrar get_order_hints
 * nem gerar resposta HTTP de erro — seguimos sem favorite_lines.
 */
async function loadCustomerFavoriteLinesSafe(
    admin: SupabaseClient,
    companyId: string,
    phoneE164: string
): Promise<Array<{ produto_embalagem_id: string; label: string; price: number }>> {
    const { data, error } = await admin.rpc("get_customer_favorites", {
        p_company_id:       companyId,
        p_customer_phone:   phoneE164,
        p_limit:            5,
    });
    if (error) {
        console.warn("[order_hints] get_customer_favorites ignorado:", error.code ?? "", error.message ?? "");
        return [];
    }
    let rows: FavoriteRpcRow[] = [];
    if (Array.isArray(data)) rows = data;
    else if (data) rows = [data as FavoriteRpcRow];
    return rows.map((f) => ({
        produto_embalagem_id: f.id,
        label:                f.name ?? f.description ?? "",
        price:                Number(f.price ?? 0),
    }));
}
