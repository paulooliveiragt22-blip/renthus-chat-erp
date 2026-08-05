/**
 * Transcreve áudio inbound WhatsApp → texto (STT) para o pipeline tratar como mensagem.
 */

import type { WaConfig } from "@/lib/whatsapp/send";
import { downloadWhatsAppMediaBytes } from "@/lib/whatsapp/downloadWaMedia";
import { createSttPort } from "@/src/pro/adapters/stt/createSttPort";

export async function tryTranscribeInboundAudio(params: {
    msg: { audio?: { id?: string; mime_type?: string }; voice?: { id?: string; mime_type?: string } };
    msgType: string;
    waConfig: WaConfig;
    companyId?: string;
}): Promise<string | null> {
    if (params.msgType !== "audio" && params.msgType !== "voice") return null;

    const stt = createSttPort();
    if (!stt) return null;

    const media =
        params.msgType === "audio"
            ? params.msg.audio
            : params.msg.voice ?? params.msg.audio;
    const mediaId = media?.id?.trim();
    if (!mediaId) return null;

    try {
        const downloaded = await downloadWhatsAppMediaBytes({
            mediaId,
            accessToken: params.waConfig.accessToken,
        });
        if (!downloaded) return null;

        const result = await stt.transcribe({
            bytes: downloaded.bytes,
            mimeType: media?.mime_type || downloaded.mimeType,
            filename: `wa-${mediaId}.ogg`,
            language: "pt",
            companyId: params.companyId,
        });

        const text = result.text.trim();
        if (!text) return null;

        console.info("[stt] transcribed inbound audio", {
            companyId: params.companyId,
            provider: result.provider,
            model: result.model,
            chars: text.length,
        });
        return text;
    } catch (err) {
        console.warn(
            "[stt] transcribe failed:",
            err instanceof Error ? err.message : err
        );
        return null;
    }
}
