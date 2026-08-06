/**
 * lib/chatbot/processMessage.ts
 *
 * Ponto de entrada do chatbot WhatsApp.
 * Motor único PRO (`runProInbound` → `runProPipeline`). Sem crédito/IA off → perfil degradado.
 */

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session } from "./types";

import type { ProcessMessageParams } from "./types";
import { runProInbound } from "./runProInbound";

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
    await runProInbound(params);
}
