import type { SpeechToTextPort } from "@/src/pro/ports/speechToText.port";
import { SttProviderError } from "@/src/pro/ports/speechToText.port";
import { OpenAiWhisperSttAdapter } from "./openai.whisper";

/**
 * - `LLM_STT_PROVIDER=openai` (ou omissão com OPENAI_API_KEY) → Whisper
 * - `LLM_STT_PROVIDER=none` → desliga STT
 */
export function createSttPort(): SpeechToTextPort | null {
    const raw = (process.env.LLM_STT_PROVIDER ?? "").trim().toLowerCase();
    if (raw === "none" || raw === "0" || raw === "off") return null;

    const provider =
        raw ||
        (process.env.OPENAI_API_KEY?.trim() ? "openai" : "none");

    if (provider === "none") return null;

    if (provider === "openai") {
        if (!process.env.OPENAI_API_KEY?.trim()) {
            console.warn("[stt] LLM_STT_PROVIDER=openai sem OPENAI_API_KEY — STT desligado");
            return null;
        }
        return new OpenAiWhisperSttAdapter();
    }

    throw new SttProviderError(`LLM_STT_PROVIDER desconhecido: ${provider}`);
}

export function isSttEnabled(): boolean {
    return createSttPort() != null;
}
