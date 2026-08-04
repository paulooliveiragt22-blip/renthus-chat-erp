import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicMenuResult } from "@/src/types/contracts.public-menu";
import { parsePublicMenuRpcPayload } from "./parsePublicMenu";
import { parseMenuSlug } from "./slug";

export async function loadPublicMenuBySlug(
    admin: SupabaseClient,
    slugRaw: string
): Promise<PublicMenuResult> {
    const slugParsed = parseMenuSlug(slugRaw);
    if (!slugParsed.ok) {
        return { ok: false, error: "menu_not_found" };
    }

    const { data, error } = await admin.rpc("rpc_get_public_menu", {
        p_slug: slugParsed.slug,
    });

    if (error) {
        console.error("[public-menu] rpc_get_public_menu:", error.message);
        return { ok: false, error: "menu_not_found" };
    }

    return parsePublicMenuRpcPayload(data);
}
