import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    AiServiceInput,
    AiServiceResult,
    AiTurn,
    OrderDraft,
} from "@/src/types/contracts";
import type { AiService } from "../../services/ai/ai.types";
import { runSearchProdutos } from "@/lib/chatbot/pro/searchProdutos";
import { buildOrderHintsPayload } from "@/lib/chatbot/pro/orderHints";
import { prepareOrderDraftFromTool } from "@/lib/chatbot/pro/prepareOrderDraft";
import { toCanonicalDraft } from "@/src/types/contracts.adapters";
import type { PrepareDraftToolInputLegacy } from "@/src/types/contracts.legacy";

type ToolName = "search_produtos" | "get_order_hints" | "prepare_order_draft";
type IntentMarker = "ok" | "unknown" | null;
type AnthropicMessage = { role: "user" | "assistant"; content: unknown };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };

const SEARCH_TOOL = {
    name: "search_produtos",
    description: "Busca catálogo real da empresa por nome/termo/categoria.",
    input_schema: {
        type: "object" as const,
        properties: {
            query: { type: "string" },
            category_hint: { type: "string" },
        },
        required: [],
    },
};

const HINTS_TOOL = {
    name: "get_order_hints",
    description: "Retorna endereços salvos e favoritos do cliente.",
    input_schema: {
        type: "object" as const,
        properties: {},
    },
};

const PREPARE_DRAFT_TOOL = {
    name: "prepare_order_draft",
    description:
        "Valida item/endereço/pagamento no servidor e devolve rascunho canônico com totais e erros.",
    input_schema: {
        type: "object" as const,
        properties: {
            items: { type: "array" },
            address: { type: "object" },
            address_raw: { type: "string" },
            saved_address_id: { type: "string" },
            use_saved_address: { type: "boolean" },
            payment_method: { type: "string" },
            change_for: { type: "number" },
            ready_for_confirmation: { type: "boolean" },
        },
        required: ["items"],
    },
};

const SYSTEM_PROMPT = `Você é o assistente PRO de delivery.
- Fale PT-BR direto.
- Não invente produto/preço/estoque.
- Sempre use tools para confirmar catálogo e draft.
- Só peça confirmação explícita quando draft estiver completo.
- Termine a resposta com:
  - INTENT_OK quando houve progresso de pedido
  - INTENT_UNKNOWN quando não houve progresso`;

function stripIntentMarker(text: string): { visible: string; marker: "ok" | "unknown" | null } {
    const t = text.trimEnd();
    if (t.endsWith("INTENT_OK")) return { visible: t.replace(/INTENT_OK\s*$/u, "").trimEnd(), marker: "ok" };
    if (t.endsWith("INTENT_UNKNOWN")) return { visible: t.replace(/INTENT_UNKNOWN\s*$/u, "").trimEnd(), marker: "unknown" };
    return { visible: t.trim(), marker: null };
}

function toAnthropicMessages(history: AiTurn[]): Array<{ role: "user" | "assistant"; content: unknown }> {
    return history
        .slice(-24)
        .map((h) => ({ role: h.role, content: h.content }));
}

function shouldEscalate(input: AiServiceInput, marker: IntentMarker): boolean {
    const streak = input.context.session.misunderstandingStreak;
    if (marker === "ok") return false;
    if (input.intentDecision.intent === "human_intent") return true;
    return streak + 1 >= input.context.policies.escalationRule.unknownConsecutive;
}

export class FullAiServiceAdapter implements AiService {
    constructor(private readonly admin: SupabaseClient) {}

    private callModel(client: Anthropic, messages: AnthropicMessage[]) {
        return client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 900,
            system: SYSTEM_PROMPT,
            messages: messages as MessageCreateParams["messages"],
            tools: [SEARCH_TOOL, HINTS_TOOL, PREPARE_DRAFT_TOOL] as MessageCreateParams["tools"],
        });
    }

    private toLegacyToolInput(raw: Record<string, unknown>): PrepareDraftToolInputLegacy {
        return {
            items: (raw.items as PrepareDraftToolInputLegacy["items"]) ?? [],
            address: (raw.address as PrepareDraftToolInputLegacy["address"]) ?? null,
            address_raw: raw.address_raw == null ? null : String(raw.address_raw),
            saved_address_id: raw.saved_address_id == null ? null : String(raw.saved_address_id),
            use_saved_address: Boolean(raw.use_saved_address),
            payment_method: raw.payment_method == null ? null : String(raw.payment_method),
            change_for: raw.change_for == null ? null : Number(raw.change_for),
            ready_for_confirmation: Boolean(raw.ready_for_confirmation),
        };
    }

    private async runSearchTool(input: AiServiceInput, block: { id: string; input: unknown }): Promise<ToolResultBlock> {
        const payload = (block.input ?? {}) as Record<string, unknown>;
        const query = String(payload.query ?? "");
        const categoryHint = payload.category_hint == null ? null : String(payload.category_hint);
        const rows = await runSearchProdutos(
            this.admin,
            input.context.tenant.companyId,
            query,
            { categoryHint, limit: 8 }
        );
        return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ items: rows }),
        };
    }

    private async runHintsTool(input: AiServiceInput, block: { id: string }): Promise<ToolResultBlock> {
        const hints = await buildOrderHintsPayload({
            admin: this.admin,
            companyId: input.context.tenant.companyId,
            phoneE164: input.context.tenant.phoneE164,
            name: input.context.actor.profileName ?? null,
        });
        return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(hints),
        };
    }

    private async runPrepareDraftTool(
        input: AiServiceInput,
        block: { id: string; input: unknown },
        currentDraft: OrderDraft | null
    ): Promise<{ result: ToolResultBlock; nextDraft: OrderDraft | null }> {
        const raw = (block.input ?? {}) as Record<string, unknown>;
        const legacyInput = this.toLegacyToolInput(raw);
        const prepared = await prepareOrderDraftFromTool(
            this.admin,
            input.context.tenant.companyId,
            input.context.session.customerId,
            legacyInput
        );
        const nextDraft = prepared.draft ? toCanonicalDraft(prepared.draft) : currentDraft;
        return {
            nextDraft,
            result: {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({
                    ok: prepared.ok,
                    errors: prepared.errors,
                    has_draft: Boolean(prepared.draft),
                }),
            },
        };
    }

    private async executeToolBlock(
        input: AiServiceInput,
        block: { id: string; name: string; input: unknown },
        currentDraft: OrderDraft | null
    ): Promise<{ result: ToolResultBlock | null; nextDraft: OrderDraft | null }> {
        const name = block.name as ToolName;
        if (name === "search_produtos") {
            return { result: await this.runSearchTool(input, block), nextDraft: currentDraft };
        }
        if (name === "get_order_hints") {
            return { result: await this.runHintsTool(input, block), nextDraft: currentDraft };
        }
        if (name === "prepare_order_draft") {
            const out = await this.runPrepareDraftTool(input, block, currentDraft);
            return { result: out.result, nextDraft: out.nextDraft };
        }
        return { result: null, nextDraft: currentDraft };
    }

    private async executeToolRound(
        input: AiServiceInput,
        content: Array<{ type: string; id?: string; name?: string; input?: unknown }>,
        currentDraft: OrderDraft | null
    ): Promise<{ toolResults: ToolResultBlock[]; nextDraft: OrderDraft | null }> {
        const toolResults: ToolResultBlock[] = [];
        let nextDraft = currentDraft;

        for (const block of content) {
            if (block.type !== "tool_use" || !block.id || !block.name) continue;
            const executed = await this.executeToolBlock(
                input,
                { id: block.id, name: block.name, input: block.input ?? {} },
                nextDraft
            );
            nextDraft = executed.nextDraft;
            if (executed.result) toolResults.push(executed.result);
        }

        return { toolResults, nextDraft };
    }

    private buildHistory(input: AiServiceInput, assistantContent: unknown): AiTurn[] {
        return [
            ...input.history,
            { role: "user" as const, content: input.userText, ts: Date.now() },
            { role: "assistant" as const, content: assistantContent, ts: Date.now() },
        ].slice(-input.limits.maxHistoryTurns);
    }

    private buildSuccess(
        input: AiServiceInput,
        replyText: string,
        marker: IntentMarker,
        toolRoundsUsed: number,
        updatedDraft: OrderDraft | null,
        assistantContent: unknown
    ): AiServiceResult {
        const nextHistory = this.buildHistory(input, assistantContent);
        if (shouldEscalate(input, marker)) {
            return {
                action: "escalate",
                replyText:
                    replyText || "Não estou conseguindo entender bem. Você prefere catálogo, atendente ou tentar de novo?",
                updatedDraft,
                updatedHistory: nextHistory,
                signals: { toolRoundsUsed, intentMarker: marker },
            };
        }

        const shouldConfirm = Boolean(updatedDraft?.pendingConfirmation);
        return {
            action: shouldConfirm ? "request_confirmation" : "reply",
            replyText: replyText || "Pode me passar mais detalhes do pedido?",
            updatedDraft,
            updatedHistory: nextHistory,
            signals: { toolRoundsUsed, intentMarker: marker },
        };
    }

    private buildProviderError(input: AiServiceInput, toolRoundsUsed: number): AiServiceResult {
        return {
            action: "error",
            replyText: "Tive uma falha ao processar sua mensagem. Pode tentar novamente?",
            updatedDraft: input.draft,
            updatedHistory: input.history,
            signals: { toolRoundsUsed, intentMarker: "unknown" },
            errorCode: "AI_PROVIDER_ERROR",
        };
    }

    async run(input: AiServiceInput): Promise<AiServiceResult> {
        if (!process.env.ANTHROPIC_API_KEY) {
            return {
                action: "error",
                replyText: "Estou sem conexão com IA agora. Pode tentar novamente em instantes?",
                updatedDraft: input.draft,
                updatedHistory: input.history,
                signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                errorCode: "AI_PROVIDER_ERROR",
            };
        }

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        let messages: AnthropicMessage[] = [
            ...toAnthropicMessages(input.history),
            { role: "user" as const, content: input.userText },
        ];
        let toolRoundsUsed = 0;
        let updatedDraft: OrderDraft | null = input.draft;

        try {
            let response = await this.callModel(client, messages);

            while (response.stop_reason === "tool_use" && toolRoundsUsed < input.limits.maxToolRounds) {
                toolRoundsUsed += 1;
                const round = await this.executeToolRound(
                    input,
                    response.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>,
                    updatedDraft
                );
                updatedDraft = round.nextDraft;

                messages = [
                    ...messages,
                    { role: "assistant", content: response.content },
                    { role: "user", content: round.toolResults },
                ];

                response = await this.callModel(client, messages);
            }

            const text = response.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")
                .trim();

            const { visible, marker } = stripIntentMarker(text);
            return this.buildSuccess(input, visible, marker, toolRoundsUsed, updatedDraft, response.content);
        } catch {
            return this.buildProviderError(input, toolRoundsUsed);
        }
    }
}

