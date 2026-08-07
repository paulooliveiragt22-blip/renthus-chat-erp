import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderHintsPayload } from "@/src/pro/tools/orderHints";

export type OrderHintsQuery = {
    companyId: string;
    phoneE164: string;
    name?: string | null;
};

/**
 * Hints de endereço/favoritos — porta de leitura (CA).
 */
export interface OrderHintsPort {
    buildHints(query: OrderHintsQuery): Promise<Record<string, unknown>>;
}

export class SupabaseOrderHintsAdapter implements OrderHintsPort {
    constructor(private readonly admin: SupabaseClient) {}

    async buildHints(query: OrderHintsQuery): Promise<Record<string, unknown>> {
        return buildOrderHintsPayload({
            admin: this.admin,
            companyId: query.companyId,
            phoneE164: query.phoneE164,
            name: query.name ?? null,
        });
    }
}
