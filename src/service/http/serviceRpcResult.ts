import type { SupabaseClient } from "@supabase/supabase-js";

export async function callServiceRpc(
    admin: SupabaseClient,
    fn: string,
    args: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) {
        return { status: 500, body: { ok: false, error: error.message } };
    }
    const row = data && typeof data === "object" ? (data as { ok?: unknown; code?: unknown }) : null;
    const code = typeof row?.code === "string" ? row.code : "";
    if (row?.ok === false && (code === "not_service" || code === "agenda_off" || code === "cases_off" || code === "cross_tenant")) {
        return { status: 403, body: data };
    }
    if (row?.ok === false) {
        return { status: 400, body: data };
    }
    return { status: 200, body: data };
}
