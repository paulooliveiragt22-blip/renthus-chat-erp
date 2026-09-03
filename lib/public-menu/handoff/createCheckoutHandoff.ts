import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft } from "@/src/types/contracts";
import { parseSlugFromPublicMenuUrl, withMenuSearchParams } from "@/lib/public-menu/menuUrlQuery";
import { signMenuHandoffToken } from "@/lib/public-menu/sessionToken";
import { mapDraftToMenuCart } from "./mapDraftToMenuCart";

const HANDOFF_TTL_SEC = 2 * 60 * 60;

/**
 * Persiste snapshot do carrinho e devolve a URL do cardápio com `hc`.
 * Se o insert falhar, devolve a URL original (checkout sem pré-carga).
 */
export async function createCheckoutHandoff(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    webMenuUrl: string;
    draft: OrderDraft;
    /** Prefill do CheckoutDrawer (ADR-0005 C1b.2). */
    fulfillmentType?: "delivery" | "pickup" | null;
}): Promise<string> {
    const web = params.webMenuUrl.trim();
    const slug = parseSlugFromPublicMenuUrl(web);
    const cart = mapDraftToMenuCart(params.draft);
    if (!slug || cart.length === 0) {
        return withMenuSearchParams(web, { checkout: "1" });
    }

    const ft = params.fulfillmentType ?? params.draft.fulfillmentType ?? null;
    const meta: Record<string, unknown> =
        ft === "delivery" || ft === "pickup" ? { fulfillment_type: ft } : {};

    const expiresAt = new Date(Date.now() + HANDOFF_TTL_SEC * 1000).toISOString();
    const { data, error } = await params.admin
        .from("menu_handoffs")
        .insert({
            company_id: params.companyId,
            slug,
            thread_id: params.threadId,
            purpose: "checkout",
            cart,
            meta,
            expires_at: expiresAt,
        })
        .select("id")
        .single();

    if (error || !data?.id) {
        console.error("[public-menu] createCheckoutHandoff:", error?.message ?? "no id");
        return withMenuSearchParams(web, { checkout: "1" });
    }

    try {
        const hc = signMenuHandoffToken({
            handoffId: String(data.id),
            companyId: params.companyId,
            slug,
            ttlSec: HANDOFF_TTL_SEC,
        });
        return withMenuSearchParams(web, { hc, checkout: "1" });
    } catch (err) {
        console.error(
            "[public-menu] signMenuHandoffToken:",
            err instanceof Error ? err.message : err
        );
        return withMenuSearchParams(web, { checkout: "1" });
    }
}
