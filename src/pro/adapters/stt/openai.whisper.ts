import type {
    SpeechToTextPort,
    SttTranscribeInput,
    SttTranscribeResult,
} from "@/src/pro/ports/speechToText.port";
import { SttProviderError } from "@/src/pro/ports/speechToText.port";

const DEFAULT_MODEL = "whisper-1";
const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";

function extForMime(mime: string): string {
    const m = mime.toLowerCase();
    if (m.includes("ogg") || m.includes("opus")) return "ogg";
    if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
    if (m.includes("mp4") || m.includes("m4a")) return "m4a";
    if (m.includes("wav")) return "wav";
    if (m.includes("webm")) return "webm";
    return "ogg";
}

export class OpenAiWhisperSttAdapter implements SpeechToTextPort {
    readonly provider = "openai";

    async transcribe(input: SttTranscribeInput): Promise<SttTranscribeResult> {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
            throw new SttProviderError("OPENAI_API_KEY missing");
        }
        if (!input.bytes?.length) {
            throw new SttProviderError("empty_audio");
        }

        const model = process.env.LLM_STT_MODEL?.trim() || DEFAULT_MODEL;
        const ext = extForMime(input.mimeType || "audio/ogg");
        const filename = input.filename?.trim() || `audio.${ext}`;

        const form = new FormData();
        const blob = new Blob([new Uint8Array(input.bytes)], {
            type: input.mimeType || "application/octet-stream",
        });
        form.append("file", blob, filename);
        form.append("model", model);
        form.append("language", input.language?.trim() || "pt");
        form.append("response_format", "json");

        const res = await fetch(OPENAI_STT_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        });

        const json = (await res.json().catch(() => ({}))) as {
            text?: string;
            error?: { message?: string };
        };

        if (!res.ok) {
            throw new SttProviderError(json.error?.message ?? `OpenAI STT HTTP ${res.status}`);
        }

        const text = String(json.text ?? "").trim();
        if (!text) {
            throw new SttProviderError("empty_transcription");
        }

        return { text, provider: this.provider, model };
    }
}
