import "server-only";

import { inspectMetaAccessToken } from "@/lib/meta/exchangePageOAuth";
import { resolveMetaAppId } from "@/lib/meta/metaAppCredentials";
import {
    evaluateGrantedMetaScopes,
    metaScopeVerdictMessage,
} from "@/lib/meta/metaOauthScopes";

export async function assertWhatsappEmbeddedSignupToken(accessToken: string): Promise<void> {
    const inspection = await inspectMetaAccessToken(accessToken);
    if (!inspection.isValid) {
        throw new Error("embedded_signup_token_invalid");
    }
    const expectedApp = resolveMetaAppId();
    if (expectedApp && inspection.appId && inspection.appId !== expectedApp) {
        throw new Error("embedded_signup_token_wrong_app");
    }
    const verdict = evaluateGrantedMetaScopes(inspection.scopes, "whatsapp_embedded");
    if (!verdict.ok) {
        throw new Error(
            metaScopeVerdictMessage(verdict, "whatsapp_embedded") || "meta_scopes_rejected"
        );
    }
}
