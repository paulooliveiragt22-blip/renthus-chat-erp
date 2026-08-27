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

export const TemplateQuickReplyButtonSchema = z.object({
    type: z.literal("QUICK_REPLY"),
    text: z.string().trim().min(1).max(25),
});

export const TemplateUrlButtonSchema = z.object({
    type: z.literal("URL"),
    text: z.string().trim().min(1).max(25),
    url: z.string().trim().url().max(2000),
});

export const TemplatePhoneButtonSchema = z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().trim().min(1).max(25),
    phoneNumber: z
        .string()
        .trim()
        .regex(/^\+[1-9]\d{7,14}$/, "phone_e164_required"),
});

export const TemplateButtonSchema = z.discriminatedUnion("type", [
    TemplateQuickReplyButtonSchema,
    TemplateUrlButtonSchema,
    TemplatePhoneButtonSchema,
]);

export const SubmitWhatsappTemplateBodySchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1)
            .max(512)
            .regex(/^[a-z0-9_]+$/, "name_snake_case_only"),
        language: z.string().trim().min(2).max(15).default("pt_BR"),
        category: WhatsappTemplateCategorySchema.default("UTILITY"),
        /** Header TEXT opcional (mídia fica fora do T3 — exige upload handle Meta). */
        headerText: z.string().trim().min(1).max(60).optional(),
        headerExample: z.string().trim().min(1).max(60).optional(),
        bodyText: z.string().trim().min(1).max(1024),
        footerText: z.string().trim().max(60).optional(),
        exampleBodyValues: z.array(z.string().trim().min(1)).max(10).optional(),
        buttons: z.array(TemplateButtonSchema).max(3).optional(),
    })
    .superRefine((val, ctx) => {
        if (val.headerText?.includes("{{") && !val.headerExample?.trim()) {
            ctx.addIssue({
                code: "custom",
                path: ["headerExample"],
                message: "header_example_required",
            });
        }
        const buttons = val.buttons ?? [];
        const urlCount = buttons.filter((b) => b.type === "URL").length;
        const phoneCount = buttons.filter((b) => b.type === "PHONE_NUMBER").length;
        if (urlCount > 2) {
            ctx.addIssue({
                code: "custom",
                path: ["buttons"],
                message: "max_two_url_buttons",
            });
        }
        if (phoneCount > 1) {
            ctx.addIssue({
                code: "custom",
                path: ["buttons"],
                message: "max_one_phone_button",
            });
        }
    });

export type SubmitWhatsappTemplateBody = z.infer<typeof SubmitWhatsappTemplateBodySchema>;
export type TemplateButton = z.infer<typeof TemplateButtonSchema>;
