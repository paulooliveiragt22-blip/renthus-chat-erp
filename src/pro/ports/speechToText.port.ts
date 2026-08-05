/**
 * Porta STT — WhatsApp áudio → texto antes do motor do chatbot.
 */

export type SttTranscribeInput = {
    bytes: Buffer;
    mimeType: string;
    filename?: string;
    language?: string;
    companyId?: string;
};

export type SttTranscribeResult = {
    text: string;
    provider: string;
    model: string;
};

export interface SpeechToTextPort {
    transcribe(input: SttTranscribeInput): Promise<SttTranscribeResult>;
}

export class SttProviderError extends Error {
    readonly code = "STT_PROVIDER_ERROR";
    constructor(message: string) {
        super(message);
        this.name = "SttProviderError";
    }
}
