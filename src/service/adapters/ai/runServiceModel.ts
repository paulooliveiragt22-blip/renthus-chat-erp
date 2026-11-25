import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import { QueueRetryableError } from "@/lib/chatbot/queueRetry";
import {
    defaultModelForProvider,
    envModelForProvider,
    getConfiguredLlmProviderName,
    resolveLanguageModel,
} from "@/src/pro/adapters/ai/modelProvider";
import {
    listFreeSlotsInput,
    proposeCaseInput,
    proposeSlotInput,
    rescheduleInput,
    respondInput,
    appointmentIdInput,
} from "@/src/service/domain/toolInput";
import type { ServiceToolName } from "@/src/service/domain/types";
import type { ServiceModelPort, ServiceModelRequest } from "@/src/service/ports/serviceTurnPorts";

const MODEL_TIMEOUT_MS = 45_000;

export function createServiceModel(): ServiceModelPort {
    return {
        async run(input) {
            const provider = getConfiguredLlmProviderName();
            const modelId = envModelForProvider(provider) || defaultModelForProvider(provider);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
            try {
                const result = await generateText({
                    model: resolveLanguageModel(),
                    system: input.system,
                    prompt: input.userText,
                    tools: buildTools(input) as ToolSet,
                    stopWhen: stepCountIs(input.maxSteps),
                    abortSignal: controller.signal,
                    prepareStep: ({ stepNumber }) =>
                        stepNumber >= input.maxSteps - 1
                            ? { toolChoice: { type: "tool", toolName: "respond_to_customer" } }
                            : undefined,
                });
                return {
                    replyText: readReply(result.steps as ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string; input: unknown }> }>),
                    model: modelId,
                    inputTokens: result.steps.reduce((sum, step) => sum + (step.usage?.inputTokens ?? 0), 0),
                    outputTokens: result.steps.reduce((sum, step) => sum + (step.usage?.outputTokens ?? 0), 0),
                };
            } catch (error: unknown) {
                if (isRateLimit(error)) {
                    throw new QueueRetryableError("AI_RATE_LIMIT", "LLM rate limited — requeue with backoff");
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

function buildTools(input: ServiceModelRequest): Record<string, unknown> {
    const tools: Record<string, unknown> = {};
    const run = (name: ServiceToolName, raw: unknown) => input.executeTool(name, raw);
    for (const name of input.tools) {
        switch (name) {
            case "list_free_slots":
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: listFreeSlotsInput,
                    execute: async (raw) => run(name, raw),
                });
                break;
            case "propose_slot":
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: proposeSlotInput,
                    execute: async (raw) => run(name, raw),
                });
                break;
            case "cancel_appointment":
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: appointmentIdInput,
                    execute: async (raw) => run(name, raw),
                });
                break;
            case "reschedule_appointment":
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: rescheduleInput,
                    execute: async (raw) => run(name, raw),
                });
                break;
            case "propose_case":
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: proposeCaseInput,
                    execute: async (raw) => run(name, raw),
                });
                break;
            case "respond_to_customer":
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: respondInput,
                    execute: async (raw) => run(name, raw),
                });
                break;
            default:
                tools[name] = tool({
                    description: descriptionFor(name),
                    inputSchema: z.object({}),
                    execute: async (raw) => run(name, raw),
                });
        }
    }
    return tools;
}

function descriptionFor(name: ServiceToolName): string {
    switch (name) {
        case "list_offerings":
            return "Lista as ofertas ativas da empresa. price_cents nulo significa sem preço.";
        case "list_free_slots":
            return "Lista inícios livres de uma oferta num dia YYYY-MM-DD.";
        case "propose_slot":
            return "Oferece um início que veio de list_free_slots. Não marca o horário.";
        case "list_appointments":
            return "Lista horários futuros confirmados deste telefone. O id daqui é o único que cancelar ou remarcar aceita.";
        case "cancel_appointment":
            return "Cancela um horário futuro deste telefone. Só se a ferramenta existir.";
        case "reschedule_appointment":
            return "Remarca um horário futuro deste telefone para um início livre.";
        case "list_open_cases":
            return "Lista cards abertos ou em andamento deste telefone.";
        case "propose_case":
            return "Oferece abrir um card. Não abre o card.";
        case "request_human":
            return "Chama uma pessoa da empresa.";
        case "respond_to_customer":
            return "Tool final obrigatória. reply_text é a mensagem ao cliente.";
    }
}

function readReply(steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string; input: unknown }> }>): string {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
        const call = steps[index]?.toolCalls.find((item) => item.toolName === "respond_to_customer");
        if (!call) continue;
        const parsed = respondInput.safeParse(call.input);
        if (parsed.success) return parsed.data.reply_text;
    }
    return "";
}

function isRateLimit(error: unknown): boolean {
    if (error instanceof QueueRetryableError) return true;
    if (!error || typeof error !== "object") return false;
    if ("statusCode" in error && error.statusCode === 429) return true;
    const message = error instanceof Error ? error.message : "";
    return message.toLowerCase().includes("rate limit") || message.includes("429");
}
