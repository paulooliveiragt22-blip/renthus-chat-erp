import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFeature } from "@/lib/billing/entitlements";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

const FEATURE_HINTS: Record<string, string> = {
    marketplace_ifood: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    marketplace_aiqfome: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    omnichannel_ig_messenger: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    table_service: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    mobile_app: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    printing_auto: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    estoque_full: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    financeiro_full: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    pdv: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
};

/** 403 se a empresa não tiver a feature no plano atual. */
export async function requirePlanFeature(
    admin: SupabaseClient,
    companyId: string,
    featureKey: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
    const allowed = await hasFeature(admin, companyId, featureKey);
    if (allowed) return { ok: true };
    return {
        ok: false,
        response: NextResponse.json(
            {
                error: "plan_feature_required",
                feature: featureKey,
                hint:
                    FEATURE_HINTS[featureKey] ??
                    "Recurso não incluído no seu plano. Faça upgrade em Configurações → Plano.",
            },
            { status: 403 }
        ),
    };
}

/** Sessão + workspace + feature do plano em um passo. */
export async function requireCompanyPlanFeature(
    featureKey: string,
    allowedRoles?: string[]
): Promise<
    | {
          ok: true;
          admin: SupabaseClient;
          companyId: string;
          userId: string;
          role: string;
      }
    | { ok: false; response: NextResponse }
> {
    const ctx = await requireCompanyAccess(allowedRoles);
    if (!ctx.ok) {
        return {
            ok: false,
            response: NextResponse.json({ error: ctx.error }, { status: ctx.status }),
        };
    }
    const feat = await requirePlanFeature(ctx.admin, ctx.companyId, featureKey);
    if (!feat.ok) return feat;
    return {
        ok: true,
        admin: ctx.admin,
        companyId: ctx.companyId,
        userId: ctx.userId,
        role: ctx.role,
    };
}
