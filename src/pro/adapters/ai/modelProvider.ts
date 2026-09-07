/**
 * Seleção de `LanguageModel` (Vercel AI SDK) por env — substitui o papel de
 * `createLlmPort`/`LlmPort` nesta migração (ver `docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md`).
 *
 * - `LLM_PROVIDER=anthropic` (default) → Claude via `@ai-sdk/anthropic`
 * - `LLM_PROVIDER=openai` → GPT via `@ai-sdk/openai`
 * - `LLM_PROVIDER=ollama` → Modelo local (Llama 3.1, Qwen2.5-Coder, etc.) via Ollama + @ai-sdk/openai-compatible
 * - `LLM_PROVIDER=groq` → Groq Cloud (openai/gpt-oss-120b) via **@ai-sdk/groq**
 *   (não usar openai-compatible genérico: replay de `reasoning_content` quebra tool loops)
 * - `LLM_MODEL` (opcional) sobrepõe o default **somente** quando o provider resolvido
 *   é o mesmo de `LLM_PROVIDER` no env. Company override (ex.: empresa em Anthropic com
 *   Lambda ainda em Groq) usa o `DEFAULT_*` daquele motor — nunca herda `openai/gpt-oss-*`
 *   no Claude.
 *
 * Mesmos nomes de env var que `createLlmPort.ts` já usava — não introduzir nomes novos.
 *
 * Para usar Ollama localmente:
 *  1. Instale: https://ollama.com/download (Windows)
 *  2. Baixe um modelo: `ollama pull llama3.1:8b` ou `ollama pull qwen2.5-coder:7b`
 *  3. Garanta que o Ollama está rodando: `ollama serve`
 *  4. Defina no .env.local: LLM_PROVIDER=ollama, LLM_MODEL=llama3.1:8b
 *  5. Inicie o dev server: npm run dev
 *
 * Para usar Groq (cloud, tier grátis generoso):
 *  1. Crie conta em https://console.groq.com/keys
 *  2. Defina no .env.local: LLM_PROVIDER=groq, GROQ_API_KEY=gsk_..., LLM_MODEL=openai/gpt-oss-120b
 *  3. Inicie o dev server: npm run dev
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

export type LlmProviderName = "anthropic" | "openai" | "ollama" | "groq";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** GPT-5 mini (não gpt-4o-mini) — decisão em docs/PLANO_MULTI_PROVIDER_IA.md: tool-calling mais
 * confiável a um custo ainda bem abaixo do Haiku. Não reabrir sem benchmark novo. */
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
/** Default para Ollama local — Llama 3.1 8B (~4.9GB, ~8GB RAM).
 * Alternativas populares: qwen2.5-coder:7b (4.7GB), qwen2.5:7b-instruct (4.7GB) */
export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";
/** Default para Groq Cloud — GPT-OSS 120B (open-source OpenAI 120B, 131k contexto).
 * Tier grátis generoso, latência ~200-500ms. Pricing: $0.15/M input, $0.60/M output.
 * Fallback: openai/gpt-oss-20b (mais leve, mesma família).
 * Docs: https://console.groq.com/docs/models */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export class LlmProviderConfigError extends Error {
    readonly code = "AI_PROVIDER_ERROR";
    constructor(message: string) {
        super(message);
        this.name = "LlmProviderConfigError";
    }
}

export function getConfiguredLlmProviderName(): LlmProviderName {
    const raw = (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();
    if (raw === "" || raw === "anthropic") return "anthropic";
    if (raw === "openai") return "openai";
    if (raw === "ollama") return "ollama";
    if (raw === "groq") return "groq";
    throw new LlmProviderConfigError(`LLM_PROVIDER desconhecido: ${raw}`);
}

/**
 * `LLM_MODEL` do env só se aplica ao provider do `LLM_PROVIDER` global.
 * Evita que override de empresa (Anthropic) herde modelo Groq do Lambda.
 */
export function envModelForProvider(provider: LlmProviderName): string | undefined {
    const fromEnv = process.env.LLM_MODEL?.trim();
    if (!fromEnv) return undefined;
    try {
        if (getConfiguredLlmProviderName() !== provider) return undefined;
    } catch {
        return undefined;
    }
    return fromEnv;
}

export function defaultModelForProvider(provider: LlmProviderName): string {
    if (provider === "openai") return DEFAULT_OPENAI_MODEL;
    if (provider === "ollama") return DEFAULT_OLLAMA_MODEL;
    if (provider === "groq") return DEFAULT_GROQ_MODEL;
    return DEFAULT_ANTHROPIC_MODEL;
}

export type ResolveLanguageModelOpts = {
    /** Provider explícito (por empresa) — se ausente, cai em `getConfiguredLlmProviderName()` (env global). */
    provider?: LlmProviderName;
    /** Sobrepõe `LLM_MODEL`/default do provider resolvido. */
    model?: string;
};

/**
 * Resolve o `LanguageModel` a usar nesta chamada.
 *
 * Retrocompatível: aceita string (comportamento antigo — só sobrepõe o modelo, provider vem do
 * env) ou um objeto `{ provider?, model? }` (multi-provider por empresa — ver
 * docs/PLANO_MULTI_PROVIDER_IA.md, Fase 2). Sem argumento, comportamento idêntico ao anterior.
 */
export function resolveLanguageModel(modelOverrideOrOpts?: string | ResolveLanguageModelOpts): LanguageModel {
    const opts: ResolveLanguageModelOpts =
        typeof modelOverrideOrOpts === "string" ? { model: modelOverrideOrOpts } : modelOverrideOrOpts ?? {};
    const provider = opts.provider ?? getConfiguredLlmProviderName();
    const resolvedModel =
        opts.model?.trim() || envModelForProvider(provider) || defaultModelForProvider(provider);

    if (provider === "anthropic") {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new LlmProviderConfigError("ANTHROPIC_API_KEY missing");
        return createAnthropic({ apiKey })(resolvedModel);
    }

    if (provider === "openai") {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) throw new LlmProviderConfigError("OPENAI_API_KEY missing");
        return createOpenAI({ apiKey })(resolvedModel);
    }

    if (provider === "groq") {
        // @ai-sdk/groq (não openai-compatible): evita replay de reasoning_content
        // que o Chat Completions da Groq rejeita no 2º step do tool loop.
        // Docs AI SDK + issues: vercel/ai#8056, cherry-studio#13735.
        const apiKey = process.env.GROQ_API_KEY?.trim();
        if (!apiKey) throw new LlmProviderConfigError("GROQ_API_KEY missing");
        return createGroq({ apiKey })(resolvedModel);
    }

    // provider === "ollama" — local via Ollama (Llama 3.1, Qwen2.5-Coder, etc.)
    // Ollama expõe uma API compatível com OpenAI em http://localhost:11434/v1
    // Não exige API key; o `OLLAMA_BASE_URL` é opcional (default: http://localhost:11434/v1).
    const baseURL = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1").trim();
    return createOpenAICompatible({
        name: "ollama",
        baseURL,
        // Ollama não exige api key real; o provider do AI SDK exige uma string não vazia.
        apiKey: process.env.OLLAMA_API_KEY?.trim() || "ollama-no-key-required",
    })(resolvedModel);
}
