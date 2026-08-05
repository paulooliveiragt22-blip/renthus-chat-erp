/**
 * Adapter Anthropic por trás de `LlmPort`.
 * Resilience + billing ficam aqui; o AiService só vê o port.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParams, ToolChoice } from "@anthropic-ai/sdk/resources/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAnthropicWithResilience } from "@/lib/chatbot/anthropicResilience";
import type {
    LlmChatRequest,
    LlmChatResponse,
    LlmPort,
} from "@/src/pro/ports/llm.port";
import { LlmProviderError, LlmTimeoutError } from "@/src/pro/ports/llm.port";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export class AnthropicLlmAdapter implements LlmPort {
    readonly provider = "anthropic";

    constructor(private readonly admin?: SupabaseClient | null) {}

    async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new LlmProviderError("ANTHROPIC_API_KEY missing");
        }

        const model = req.model?.trim() || process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
        const client = new Anthropic({ apiKey });
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort("AI_TIMEOUT"),
            Math.max(req.timeoutMs, 1000)
        );

        try {
            const body: MessageCreateParams = {
                model,
                max_tokens: req.maxTokens,
                system: req.system,
                messages: req.messages as MessageCreateParams["messages"],
            };
            if (req.tools?.length) {
                body.tools = req.tools as MessageCreateParams["tools"];
            }
            if (req.toolChoice) {
                body.tool_choice = req.toolChoice as ToolChoice;
            }

            const response = await runAnthropicWithResilience(
                () =>
                    client.messages.create(body, {
                        signal: controller.signal,
                    } as never),
                { maxRetries: 3 }
            );

            if (this.admin && req.companyId) {
                try {
                    const { debitFromAnthropicUsage } = await import("@/lib/billing/aiWallet");
                    await debitFromAnthropicUsage(this.admin, req.companyId, response.usage, {
                        source: req.purpose ?? "llm_port_anthropic",
                    });
                } catch {
                    /* billing best-effort */
                }
            }

            return {
                content: Array.isArray(response.content) ? [...response.content] : [],
                stopReason: response.stop_reason ?? null,
                usage: {
                    inputTokens: response.usage?.input_tokens,
                    outputTokens: response.usage?.output_tokens,
                },
                provider: this.provider,
                model,
            };
        } catch (error) {
            if (controller.signal.aborted) {
                throw new LlmTimeoutError();
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
