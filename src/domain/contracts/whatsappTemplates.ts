import { z } from "zod";

export const WhatsappTemplateCategorySchema = z.enum([
    "UTILITY",
    "MARKETING",
    "AUTHENTICATION",
]);

export const WhatsappTemplateStatusSchema = z.enum([
    "PENDING",
    "APPROVED",
    "REJECTED",
    "PAUSED",
    "DISABLED",
    "IN_APPEAL",
]);

export const WhatsappTemplatePublicSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    language: z.string().min(2),
    category: WhatsappTemplateCategorySchema,
    status: WhatsappTemplateStatusSchema,
    components: z.array(z.record(z.string(), z.unknown())),
    rejectionReason: z.string().nullable(),
    metaTemplateId: z.string().nullable(),
    wabaId: z.string(),
    lastSyncedAt: z.string().nullable(),
});

export type WhatsappTemplatePublic = z.infer<typeof WhatsappTemplatePublicSchema>;

export const SubmitWhatsappTemplateBodySchema = z.object({
    name: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .regex(/^[a-z0-9_]+$/, "name_snake_case_only"),
    language: z.string().trim().min(2).max(15).default("pt_BR"),
    category: WhatsappTemplateCategorySchema.default("UTILITY"),
    bodyText: z.string().trim().min(1).max(1024),
    footerText: z.string().trim().max(60).optional(),
    exampleBodyValues: z.array(z.string().trim().min(1)).max(10).optional(),
});

export type SubmitWhatsappTemplateBody = z.infer<typeof SubmitWhatsappTemplateBodySchema>;
