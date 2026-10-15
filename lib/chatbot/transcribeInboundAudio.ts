/**
 * Transcreve áudio inbound WhatsApp → texto (STT) para o pipeline tratar como mensagem.
 * Reserva a carteira antes do Whisper e liquida por duração (OpenAI $/min → BRL centavos).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaConfig } from "@/lib/whatsapp/send";
import { downloadWhatsAppMediaBytes } from "@/lib/whatsapp/downloadWaMedia";
import { beginAiTurn, debitFromSttUsage, releaseAiTurn } from "@/lib/billing/aiWallet";
import { createSttPort } from "@/src/pro/adapters/stt/createSttPort";

export async function tryTranscribeInboundAudio(params: {
    msg: { audio?: { id?: string; mime_type?: string }; voice?: { id?: string; mime_type?: string } };
    msgType: string;
    waConfig: WaConfig;
    companyId?: string;
    threadId?: string;
    /** Service role — obrigatório para gate/débito da carteira. */
    admin?: SupabaseClient | null;
}): Promise<string | null> {
    if (params.msgType !== "audio" && params.msgType !== "voice") return null;

    const stt = createSttPort();
    if (!stt) return null;

    const companyId = params.companyId?.trim() || "";
    const admin = params.admin ?? null;
    const threadId = params.threadId?.trim() || "";

    const media =
        params.msgType === "audio"
            ? params.msg.audio
            : params.msg.voice ?? params.msg.audio;
    const mediaId = media?.id?.trim();
    if (!mediaId) return null;

    const turnKey = threadId ? `${threadId}:stt:${mediaId}` : "";
    let reserved = false;
    if (companyId && admin && threadId) {
        const begun = await beginAiTurn(admin, companyId, turnKey, 1);
        if (!begun.allowed) {
            console.info("[stt] skipped: AI wallet empty", { companyId });
            return null;
        }
        reserved = true;
    }

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
            companyId: companyId || undefined,
        });

        const text = result.text.trim();
        if (!text) return null;

        if (reserved && companyId && admin) {
            const debited = await debitFromSttUsage(
                admin,
                companyId,
                {
                    model: result.model,
                    durationSec: result.durationSec,
                    byteLength: result.byteLength,
                },
                {
                    turn_key: turnKey,
                    step_key: `${turnKey}:step:0`,
                    thread_id: threadId,
                    media_id: mediaId,
                    provider: result.provider,
                }
            );
            if (!debited) {
                console.warn("[stt] transcribed but wallet debit failed (no balance)", {
                    companyId,
                    durationSec: result.durationSec,
                    model: result.model,
                });
            }
        }

        console.info("[stt] transcribed inbound audio", {
            companyId: companyId || undefined,
            provider: result.provider,
            model: result.model,
            durationSec: result.durationSec,
            chars: text.length,
        });
        return text;
    } catch (err) {
        console.warn(
            "[stt] transcribe failed:",
            err instanceof Error ? err.message : err
        );
        return null;
    } finally {
        if (reserved && companyId && admin) {
            await releaseAiTurn(admin, companyId, turnKey).catch(() => {});
        }
    }
}
