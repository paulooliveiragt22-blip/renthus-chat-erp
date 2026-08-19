import { z } from "zod";

/** Contrato Fase 1 — trace por turno (replay). kinds alinhados a OutboundMessage live. */
export const PipelineTurnTraceOutbound = z.object({
    kind: z.enum(["text", "buttons", "cta_url"]),
    text: z.string().optional(),
});

export const PipelineTurnTraceSchema = z.object({
    v: z.literal(1),
    companyId: z.string().uuid(),
    threadId: z.string().uuid(),
    channel: z.enum(["whatsapp", "instagram", "messenger", "web"]),
    inboundMessageId: z.string().min(1),
    stateBefore: z.unknown(),
    stateAfter: z.unknown(),
    outbound: z.array(PipelineTurnTraceOutbound),
    draftSnapshot: z.unknown().nullable(),
    telemetryReason: z.string().nullable(),
    aiProfile: z.enum(["degradado", "basico", "avancado"]).nullable(),
    createdAt: z.string().datetime(),
});

export type PipelineTurnTrace = z.infer<typeof PipelineTurnTraceSchema>;
