import { z } from "zod";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/src/service/domain/faq";

export const servicePresetSchema = z.enum(["horario", "servico", "consulta_caso", "balcao"]);

export const caseStageSchema = z.enum(["aberto", "em_andamento", "concluido", "perdido"]);

export const saveContextSchema = z.object({
    contextText: z.string().max(4000),
});

export const upsertFaqSchema = z.object({
    id: z.string().uuid().nullable().optional(),
    question: z.string().trim().min(1).max(FAQ_QUESTION_MAX),
    answer: z.string().trim().min(1).max(FAQ_ANSWER_MAX),
    active: z.boolean().optional(),
});

export const deleteFaqSchema = z.object({
    id: z.string().uuid(),
});

export const channelFlagsSchema = z.object({
    cancelEnabled: z.boolean(),
    rescheduleEnabled: z.boolean(),
});

export const applyPresetSchema = z.object({
    preset: servicePresetSchema,
});

export const offerLinkLabelSchema = z.enum(["Ver oferta", "Ver plano", "Ver serviço"]);

export const upsertOfferingSchema = z
    .object({
        id: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(1).max(80),
        description: z.string().max(500).nullable().optional(),
        durationMin: z.number().int().min(15).max(240).nullable(),
        priceCents: z.number().int().min(0).nullable(),
        active: z.boolean().optional(),
        linkUrl: z.string().trim().max(500).nullable().optional(),
        linkLabel: offerLinkLabelSchema.nullable().optional(),
    })
    .superRefine((value, ctx) => {
        const url = value.linkUrl?.trim() ?? "";
        if (!url) return;
        if (!url.startsWith("https://") || /\s/u.test(url)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["linkUrl"] });
        }
    });

export const siteChatPostSchema = z
    .object({
        text: z.string().trim().min(1).max(500),
        reset: z.boolean().optional(),
        key: z.string().uuid().optional(),
        offeringId: z.string().uuid().optional(),
    })
    .strict();

export const siteChatRepliesSchema = z.object({
    action: z.literal("replies"),
    replies: z.array(z.string().trim().min(1).max(80)).max(3),
});

export const adminBookSchema = z.object({
    offeringId: z.string().uuid(),
    startsAt: z.string().min(16),
    phoneE164: z.string().trim().min(8).max(20),
    customerName: z.string().trim().max(80).optional(),
    label: z.string().trim().max(120).optional(),
    caseId: z.string().uuid().nullable().optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
});

export const cancelAppointmentSchema = z.object({
    appointmentId: z.string().uuid(),
});

export const rescheduleAppointmentSchema = z.object({
    appointmentId: z.string().uuid(),
    startsAt: z.string().min(16),
    idempotencyKey: z.string().trim().min(8).max(200),
});

export const setStageSchema = z.object({
    caseId: z.string().uuid(),
    stage: caseStageSchema,
});

export const setLabelSchema = z.object({
    stage: caseStageSchema,
    label: z.string().trim().min(1).max(40),
});
