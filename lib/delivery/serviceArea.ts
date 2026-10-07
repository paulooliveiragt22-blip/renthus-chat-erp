import type { SupabaseClient } from "@supabase/supabase-js";

export type ServiceArea = {
    /** Cidade atendida — `company_delivery_policy` manda, `companies.cidade` é fallback. */
    cidade: string;
    /** UF atendida (2 letras) na mesma precedência. */
    estado: string;
};

/**
 * Cidade/UF onde a empresa entrega. Usado pra pré-preencher formulário de
 * endereço (atendente/inbox) e pela tela de política de entrega — a precedência
 * `policy → companies` precisa ser a mesma nos dois, senão o formulário sugere
 * uma cidade diferente da que a política valida.
 */
export async function loadServiceArea(
    admin: SupabaseClient,
    companyId: string
): Promise<ServiceArea> {
    const [{ data: company }, { data: policy }] = await Promise.all([
        admin.from("companies").select("cidade, uf").eq("id", companyId).maybeSingle(),
        admin
            .from("company_delivery_policy")
            .select("service_city, service_state")
            .eq("company_id", companyId)
            .maybeSingle(),
    ]);

    return {
        cidade: String(policy?.service_city ?? company?.cidade ?? "").trim(),
        estado: String(policy?.service_state ?? company?.uf ?? "")
            .trim()
            .toUpperCase()
            .slice(0, 2),
    };
}
