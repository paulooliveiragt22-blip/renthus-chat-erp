import type { SupabaseClient } from "@supabase/supabase-js";

/** Admin de teste: reserva e liquidação da carteira não batem no banco. */
export function aiWalletTestAdmin(): SupabaseClient {
    return {
        rpc: async (fn: string) => {
            if (fn === "rpc_begin_ai_turn") {
                return { data: { allowed: true, reused: false, reason: null }, error: null };
            }
            if (fn === "rpc_release_ai_turn" || fn === "rpc_settle_ai_turn") {
                return { data: { ok: true, released: true, charged_cents: 0 }, error: null };
            }
            if (fn === "rpc_note_ai_low_credit") {
                return {
                    data: {
                        notify_low: false,
                        recharge_needed: false,
                        low_balance_threshold_cents: 0,
                        remaining_total_cents: 0,
                    },
                    error: null,
                };
            }
            return { data: null, error: { message: `rpc não stubada: ${fn}` } };
        },
    } as unknown as SupabaseClient;
}
