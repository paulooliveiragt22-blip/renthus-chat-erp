/**
 * Adapter OpenAI (chat completions) atrás de `LlmPort`.
 * Aceita mensagens/tools no formato Anthropic usado pelo FullAiService e devolve
 * content/stopReason compatíveis (tool_use / end_turn).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    LlmChatRequest,
    LlmChatResponse,
    LlmMessage,
    LlmPort,
    LlmToolDef,
} from "@/src/pro/ports/llm.port";
import { LlmProviderError, LlmTimeoutError } from "@/src/pro/ports/llm.port";

const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type OpenAiMessage =
    | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

type OpenAiToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

function toOpenAiTools(tools: LlmToolDef[] | undefined) {
    if (!tools?.length) return undefined;
    return tools.map((t) => {
        const name = String(t.name ?? "tool");
        const description = typeof t.description === "string" ? t.description : undefined;
        const parameters =
            (t.input_schema as Record<string, unknown> | undefined) ??
            (t.parameters as Record<string, unknown> | undefined) ?? {
                type: "object",
                properties: {},
            };
        return {
            type: "function" as const,
            function: { name, description, parameters },
        };
    });
}

function blockText(block: unknown): string {
    if (typeof block === "string") return block;
    if (block && typeof block === "object" && "text" in block) {
        return String((block as { text?: unknown }).text ?? "");
    }
    return "";
}

/** Converte histórico Anthropic-like → mensagens OpenAI (incl. tool_calls / role=tool). */
export function anthropicStyleMessagesToOpenAi(messages: LlmMessage[]): OpenAiMessage[] {
    const out: OpenAiMessage[] = [];

    for (const msg of messages) {
        const role = msg.role;
        const content = msg.content;

        if (typeof content === "string") {
            out.push({ role, content });
            continue;
        }

        if (!Array.isArray(content)) {
            out.push({ role, content: content == null ? "" : String(content) });
            continue;
        }

        if (role === "assistant") {
            const textParts: string[] = [];
            const toolCalls: OpenAiToolCall[] = [];
            for (const block of content) {
                if (!block || typeof block !== "object") continue;
                const b = block as {
                    type?: string;
                    text?: string;
                    id?: string;
                    name?: string;
                    input?: unknown;
                };
                if (b.type === "text" && b.text) textParts.push(b.text);
                if (b.type === "tool_use" && b.id && b.name) {
                    toolCalls.push({
                        id: b.id,
                        type: "function",
                        function: {
                            name: b.name,
                            arguments: JSON.stringify(b.input ?? {}),
                        },
                    });
                }
            }
            out.push({
                role: "assistant",
                content: textParts.length ? textParts.join("\n") : null,
                ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
            });
            continue;
        }

        // user: texto e/ou tool_result
        const textParts: string[] = [];
        for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const b = block as {
                type?: string;
                text?: string;
                tool_use_id?: string;
                content?: unknown;
            };
            if (b.type === "text" && b.text) {
                textParts.push(b.text);
            } else if (b.type === "tool_result" && b.tool_use_id) {
                const toolContent =
                    typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? {});
                out.push({
                    role: "tool",
                    tool_call_id: b.tool_use_id,
                    content: toolContent,
                });
            } else if (!b.type) {
                const t = blockText(block);
                if (t) textParts.push(t);
            }
        }
        if (textParts.length) {
            out.push({ role: "user", content: textParts.join("\n") });
        }
    }

    return out;
}

function openAiResponseToAnthropicShape(json: {
    choices?: Array<{
        message?: {
            content?: string | null;
            tool_calls?: OpenAiToolCall[];
        };
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
}): { content: unknown[]; stopReason: string | null } {
    const choice = json.choices?.[0];
    const message = choice?.message;
    const content: unknown[] = [];
    if (message?.content) {
        content.push({ type: "text", text: message.content });
    }
    for (const tc of message?.tool_calls ?? []) {
        let input: unknown = {};
        try {
            input = JSON.parse(tc.function?.arguments || "{}");
        } catch {
            input = {};
        }
        content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function?.name,
            input,
        });
    }
    const finish = choice?.finish_reason ?? null;
    const stopReason =
        finish === "tool_calls" || (message?.tool_calls?.length ?? 0) > 0
            ? "tool_use"
            : finish === "stop" || finish === "length"
              ? "end_turn"
              : finish;
    return { content, stopReason };
}

export class OpenAiLlmAdapter implements LlmPort {
    readonly provider = "openai";

    constructor(private readonly admin?: SupabaseClient | null) {}

    async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
            throw new LlmProviderError("OPENAI_API_KEY missing");
        }

        const model = req.model?.trim() || process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort("AI_TIMEOUT"),
            Math.max(req.timeoutMs, 1000)
        );

        const openAiMessages: OpenAiMessage[] = [
            { role: "system", content: req.system },
            ...anthropicStyleMessagesToOpenAi(req.messages),
        ];

        const body: Record<string, unknown> = {
            model,
            max_tokens: req.maxTokens,
            messages: openAiMessages,
        };

        const tools = toOpenAiTools(req.tools);
        if (tools?.length) {
            body.tools = tools;
            if (req.toolChoice?.type === "tool" && req.toolChoice.name) {
                body.tool_choice = {
                    type: "function",
                    function: { name: req.toolChoice.name },
                };
            } else if (req.toolChoice?.type === "any") {
                body.tool_choice = "required";
            } else {
                body.tool_choice = "auto";
            }
        }

        try {
            const res = await fetch(OPENAI_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            const json = (await res.json().catch(() => ({}))) as {
                error?: { message?: string; type?: string; code?: string };
                choices?: Array<{
                    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
                    finish_reason?: string | null;
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
            };

            if (!res.ok) {
                const msg = json.error?.message ?? `OpenAI HTTP ${res.status}`;
                if (res.status === 429) {
                    const err = new Error(msg);
                    (err as { status?: number }).status = 429;
                    throw err;
                }
                throw new LlmProviderError(msg);
            }

            const shaped = openAiResponseToAnthropicShape(json);

            if (this.admin && req.companyId && json.usage) {
                try {
                    const { debitFromAnthropicUsage } = await import("@/lib/billing/aiWallet");
                    await debitFromAnthropicUsage(
                        this.admin,
                        req.companyId,
                        {
                            input_tokens: json.usage.prompt_tokens,
                            output_tokens: json.usage.completion_tokens,
                        },
                        {
                            source: req.purpose ?? "llm_port_openai",
                            provider: "openai",
                            model,
                        }
                    );
                } catch {
                    /* billing best-effort */
                }
            }

            return {
                content: shaped.content,
                stopReason: shaped.stopReason,
                usage: {
                    inputTokens: json.usage?.prompt_tokens,
                    outputTokens: json.usage?.completion_tokens,
                },
                provider: this.provider,
                model,
            };
        } catch (error) {
            if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
                throw new LlmTimeoutError();
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
