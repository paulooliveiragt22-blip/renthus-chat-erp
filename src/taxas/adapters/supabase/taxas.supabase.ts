import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    ApplyOrderFeeInput,
    OrderFeeLine,
    ServiceFeeCalcMode,
    ServiceFeeDefinition,
    ServiceFeeSystemKey,
    UpsertServiceFeePayload,
} from "@/src/taxas/domain/types";
import type { TaxasCommandPort } from "@/src/taxas/ports/taxas.port";

function mapDef(row: Record<string, unknown>): ServiceFeeDefinition {
    return {
        id: String(row.id),
        company_id: String(row.company_id),
        name: String(row.name),
        slug: String(row.slug),
        system_key: (row.system_key as ServiceFeeSystemKey | null) ?? null,
        calc_mode: row.calc_mode as ServiceFeeCalcMode,
        value: Number(row.value ?? 0),
        is_active: Boolean(row.is_active),
        sort_order: Number(row.sort_order ?? 100),
    };
}

function mapFee(row: Record<string, unknown>): OrderFeeLine {
    return {
        id: String(row.id),
        name: String(row.name),
        system_key: (row.system_key as ServiceFeeSystemKey | null) ?? null,
        calc_mode: row.calc_mode as ServiceFeeCalcMode,
        rate_or_amount: Number(row.rate_or_amount ?? 0),
        amount: Number(row.amount ?? 0),
        definition_id: row.definition_id != null ? String(row.definition_id) : null,
    };
}

export const taxasSupabase: TaxasCommandPort = {
    async listDefinitions(admin, companyId, opts) {
        let q = admin
            .from("service_fee_definitions")
            .select(
                "id, company_id, name, slug, system_key, calc_mode, value, is_active, sort_order"
            )
            .eq("company_id", companyId)
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });
        if (opts?.activeOnly) q = q.eq("is_active", true);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => mapDef(r as Record<string, unknown>));
    },

    async upsertDefinition(admin, companyId, payload) {
        const { data, error } = await admin.rpc("rpc_upsert_service_fee_definition", {
            p_company_id: companyId,
            p_payload: payload,
        });
        if (error) throw new Error(error.message);
        return String(data);
    },

    async deactivateDefinition(admin, companyId, definitionId) {
        const { error } = await admin
            .from("service_fee_definitions")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", definitionId)
            .eq("company_id", companyId);
        if (error) throw new Error(error.message);
    },

    async listOrderFees(admin, companyId, orderId) {
        const { data, error } = await admin
            .from("order_fees")
            .select("id, name, system_key, calc_mode, rate_or_amount, amount, definition_id")
            .eq("company_id", companyId)
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => mapFee(r as Record<string, unknown>));
    },

    async applyOrderFees(admin, companyId, orderId, fees) {
        const { data, error } = await admin.rpc("rpc_apply_order_fees", {
            p_company_id: companyId,
            p_order_id: orderId,
            p_fees: fees,
        });
        if (error) throw new Error(error.message);
        const rows = Array.isArray(data) ? data : [];
        return rows.map((r) => mapFee(r as Record<string, unknown>));
    },
};

export type { UpsertServiceFeePayload, ApplyOrderFeeInput };
