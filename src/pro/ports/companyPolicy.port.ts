import type { SupabaseClient } from "@supabase/supabase-js";

export type HighValueConfirmPolicy = {
    enabled: boolean;
    amountBrl: number;
};

/**
 * Política de confirmação de valor alto (config do chatbot) — porta de leitura.
 * Evita `admin.from("chatbots")` direto no orquestrador.
 */
export interface CompanyPolicyPort {
    getHighValueConfirmPolicy(companyId: string): Promise<HighValueConfirmPolicy | undefined>;
}

export class SupabaseCompanyPolicyAdapter implements CompanyPolicyPort {
    constructor(private readonly admin: SupabaseClient) {}

    async getHighValueConfirmPolicy(companyId: string): Promise<HighValueConfirmPolicy | undefined> {
        try {
            const { data: botRow } = await this.admin
                .from("chatbots")
                .select("config")
                .eq("company_id", companyId)
                .limit(1)
                .maybeSingle();
            const { parseHighValueConfirmPolicy } = await import("@/lib/billing/aiWallet");
            return parseHighValueConfirmPolicy(
                (botRow?.config as Record<string, unknown> | null) ?? null
            );
        } catch {
            return undefined;
        }
    }
}
