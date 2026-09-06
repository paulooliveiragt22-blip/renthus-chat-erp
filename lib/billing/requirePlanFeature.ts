import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFeature } from "@/lib/billing/entitlements";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import type { CapabilityKey } from "@/lib/workspace/rbac/capabilities";
import { jsonAccessError } from "@/lib/api/errors";

const FEATURE_HINTS: Record<string, string> = {
    marketplace_ifood: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    marketplace_aiqfome: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    omnichannel_ig_messenger: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    table_service: "Disponível no plano Market. Faça upgrade em Configurações → Plano.",
    printing_auto: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    staff_users: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    estoque_full: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    financeiro_full: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    pdv: "Disponível no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    pdv_basic: "Disponível nos planos Essencial, Pro ou Market.",
    whatsapp_templates_broadcast:
        "Templates WhatsApp e campanhas disponíveis no plano Pro ou Market. Faça upgrade em Configurações → Plano.",
    whatsapp_messages: "Canal WhatsApp não incluído no seu plano. Faça upgrade em Configurações → Plano.",
};

/** True se a empresa tem ao menos uma das features. */
export async function hasAnyPlanFeature(
    admin: SupabaseClient,
    companyId: string,
    featureKeys: string[]
): Promise<boolean> {
    for (const key of featureKeys) {
        if (await hasFeature(admin, companyId, key)) return true;
    }
    return false;
}

/** 403 se nenhuma das features estiver no plano. */
export async function requireAnyPlanFeature(
    admin: SupabaseClient,
    companyId: string,
    featureKeys: string[]
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
    if (await hasAnyPlanFeature(admin, companyId, featureKeys)) return { ok: true };
    const primary = featureKeys[0] ?? "feature";
    return {
        ok: false,
        response: NextResponse.json(
            {
                error: "plan_feature_required",
                feature: primary,
                features: featureKeys,
                hint:
                    FEATURE_HINTS[primary] ??
                    "Recurso não incluído no seu plano. Faça upgrade em Configurações → Plano.",
            },
            { status: 403 }
        ),
    };
}

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
    allowedRoles?: string[],
    capability?: CapabilityKey | CapabilityKey[]
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
    const ctx = capability
        ? await requireCapability(capability)
        : await requireCompanyAccess(allowedRoles);
    if (!ctx.ok) {
        return { ok: false, response: jsonAccessError(ctx) };
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

/** Sessão + workspace + qualquer feature da lista (ex.: pdv_basic | pdv). */
export async function requireCompanyAnyPlanFeature(
    featureKeys: string[],
    allowedRoles?: string[],
    capability?: CapabilityKey | CapabilityKey[]
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
    const ctx = capability
        ? await requireCapability(capability)
        : await requireCompanyAccess(allowedRoles);
    if (!ctx.ok) {
        return { ok: false, response: jsonAccessError(ctx) };
    }
    const feat = await requireAnyPlanFeature(ctx.admin, ctx.companyId, featureKeys);
    if (!feat.ok) return feat;
    return {
        ok: true,
        admin: ctx.admin,
        companyId: ctx.companyId,
        userId: ctx.userId,
        role: ctx.role,
    };
}

export const PDV_ACCESS_FEATURES = ["pdv_basic", "pdv"] as const;
