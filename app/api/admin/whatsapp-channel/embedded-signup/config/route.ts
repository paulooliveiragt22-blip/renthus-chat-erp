import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    metaGraphVersion,
    resolveEmbeddedSignupConfigId,
    resolveMetaAppId,
} from "@/lib/meta/metaAppCredentials";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyPlanFeature("whatsapp_messages", ["owner", "admin"]);
    if (!ctx.ok) return ctx.response;

    const appId = resolveMetaAppId();
    const configId = resolveEmbeddedSignupConfigId();
    if (!appId || !configId) {
        return NextResponse.json(
            {
                error: "embedded_signup_not_configured",
                hint: "Defina META_APP_ID e META_EMBEDDED_SIGNUP_CONFIG_ID no ambiente.",
            },
            { status: 503 }
        );
    }

    return NextResponse.json({
        appId,
        configId,
        graphVersion: metaGraphVersion(),
        featureTypeDefault: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
    });
}
