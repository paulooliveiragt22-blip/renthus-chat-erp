import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Defense against association IDOR: foreign UUIDs must belong to the session company.
 */
export async function assertCustomerInCompany(
    admin: SupabaseClient,
    companyId: string,
    customerId: string
): Promise<{ ok: true } | { ok: false; error: "customer_not_in_company" }> {
    const id = customerId.trim();
    if (!id) return { ok: false, error: "customer_not_in_company" };
    const { data } = await admin
        .from("customers")
        .select("id")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();
    if (!data?.id) return { ok: false, error: "customer_not_in_company" };
    return { ok: true };
}

export async function assertThreadInCompany(
    admin: SupabaseClient,
    companyId: string,
    threadId: string
): Promise<{ ok: true } | { ok: false; error: "thread_not_in_company" }> {
    const id = threadId.trim();
    if (!id) return { ok: false, error: "thread_not_in_company" };
    const { data } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle();
    if (!data?.id) return { ok: false, error: "thread_not_in_company" };
    return { ok: true };
}
