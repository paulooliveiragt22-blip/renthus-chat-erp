import { z } from "zod";

export const servicePresetSchema = z.enum(["horario", "servico", "consulta_caso", "balcao"]);

export const caseStageSchema = z.enum(["aberto", "em_andamento", "concluido", "perdido"]);

export const saveContextSchema = z.object({
    contextText: z.string().max(4000),
});

export const channelFlagsSchema = z.object({
    cancelEnabled: z.boolean(),
    rescheduleEnabled: z.boolean(),
});

export const applyPresetSchema = z.object({
    preset: servicePresetSchema,
});

export const upsertOfferingSchema = z.object({
    id: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).nullable().optional(),
    durationMin: z.number().int().min(15).max(240).nullable(),
    priceCents: z.number().int().min(0).nullable(),
    active: z.boolean().optional(),
});

export const adminBookSchema = z.object({
    offeringId: z.string().uuid(),
    startsAt: z.string().min(16),
    phoneE164: z.string().trim().min(8).max(20),
    customerName: z.string().trim().max(80).optional(),
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
