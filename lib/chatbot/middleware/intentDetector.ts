/**
 * lib/chatbot/middleware/intentDetector.ts
 *
 * Detecta intenções globais via regex (zero tokens de IA) antes do classificador:
 *   - Reset explícito (limpar/reiniciar)
 *   - Detecção de nome do cliente ("me chamo…")
 *
 * Retorna { handled: true } quando a mensagem foi totalmente processada.
 * Retorna { handled: false } para continuar o fluxo normal.
 */

import type { Session, CompanyConfig } from "../types";
import type { ProcessMessageParams } from "../types";
import { saveSession } from "../session";
import { botReply } from "../botSend";
import { sendInteractiveButtons } from "../../whatsapp/send";
import { normalize } from "../utils";

const EXPLICIT_RESET_RE = /\b(?:limpar|reiniciar|esvaziar|comecar|recomecar)\b/iu;
const CLIENT_NAME_RE    = /\b(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+(?:o|a)\s+|pode\s+me\s+chamar\s+de)\s+([A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,})?)/iu;

async function sendWelcomeButtons(
    phoneE164: string,
    companyName: string,
    waConfig: ProcessMessageParams["waConfig"]
): Promise<void> {
    await sendInteractiveButtons(
        phoneE164,
        `Como posso te ajudar no *${companyName}*? 🍺`,
        [
            { id: "btn_catalog", title: "🛒 Ver Catálogo" },
            { id: "btn_status",  title: "📦 Meu pedido" },
            { id: "btn_support", title: "🙋 Falar c/ atendente" },
        ],
        waConfig
    );
}

export async function detectGlobalIntents(
    params: ProcessMessageParams,
    session: Session,
    config: CompanyConfig
): Promise<{ handled: boolean }> {
    const { admin, companyId, threadId, phoneE164, waConfig } = params;
    const input       = params.text.trim();
    const norm        = normalize(input);
    const companyName = config.name;

    // ── Reset explícito ───────────────────────────────────────────────────────
    if (EXPLICIT_RESET_RE.test(norm)) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await sendWelcomeButtons(phoneE164, companyName, waConfig);
        return { handled: true };
    }

    // ── Detecção de nome ──────────────────────────────────────────────────────
    const nameMatch = CLIENT_NAME_RE.exec(input);
    if (nameMatch?.[1]) {
        const detectedName = nameMatch[1].trim();
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, client_name: detectedName },
        });
        if (session.customer_id) {
            await admin
                .from("customers")
                .update({ name: detectedName })
                .eq("id", session.customer_id);
        }
        await botReply(admin, companyId, threadId, phoneE164, `Olá, *${detectedName}*! 😊 Como posso te ajudar?`);
        return { handled: true };
    }

    return { handled: false };
}
