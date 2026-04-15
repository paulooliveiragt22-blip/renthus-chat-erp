import type { AiService } from "../../services/ai/ai.types";
import type { AiServiceResult } from "@/src/types/contracts";

/**
 * Adapter básico para ligar o pipeline V2 sem acoplar no legado.
 * Mantém respostas seguras e previsíveis enquanto a IA PRO V2 completa não é implementada.
 */
export class BasicAiServiceAdapter implements AiService {
    async run(input: Parameters<AiService["run"]>[0]): Promise<AiServiceResult> {
        const hasDraft = Boolean(input.draft && input.draft.items.length > 0);

        if (input.intentDecision.intent === "unknown") {
            return {
                action: "request_clarification",
                replyText: "Não entendi direito. Me diga os itens, endereço e forma de pagamento.",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
            };
        }

        if (hasDraft) {
            return {
                action: "request_confirmation",
                replyText: "Posso fechar esse pedido agora? Responda com *sim* para confirmar.",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                signals: { toolRoundsUsed: 0, intentMarker: "ok" },
            };
        }

        return {
            action: "request_clarification",
            replyText:
                "Para montar seu pedido, me envie os itens com quantidade. Exemplo: 2 Heineken 600ml.",
            updatedDraft: input.draft,
            updatedHistory: input.history,
            signals: { toolRoundsUsed: 0, intentMarker: "ok" },
        };
    }
}

