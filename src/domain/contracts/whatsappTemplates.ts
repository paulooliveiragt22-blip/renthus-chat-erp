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

export const TemplateCopyCodeButtonSchema = z.object({
    type: z.literal("COPY_CODE"),
    example: z.string().trim().min(1).max(15),
});

export const TemplateButtonSchema = z.discriminatedUnion("type", [
    TemplateQuickReplyButtonSchema,
    TemplateUrlButtonSchema,
    TemplatePhoneButtonSchema,
    TemplateCopyCodeButtonSchema,
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
        marketingKind: z.enum(["custom", "limited_time_offer"]).optional(),
        /** Header TEXT opcional. Mídia exige handle da Meta e fica fora deste envio. */
        headerText: z.string().trim().min(1).max(60).optional(),
        headerExample: z.string().trim().min(1).max(60).optional(),
        bodyText: z.string().trim().max(1024).optional(),
        footerText: z.string().trim().max(60).optional(),
        exampleBodyValues: z.array(z.string().trim().min(1)).max(10).optional(),
        buttons: z.array(TemplateButtonSchema).max(10).optional(),
        offerText: z.string().trim().min(1).max(16).optional(),
        offerHasExpiration: z.boolean().optional(),
        addSecurityRecommendation: z.boolean().optional(),
        codeExpirationMinutes: z.number().int().min(1).max(90).optional(),
        otpType: z.enum(["COPY_CODE", "ONE_TAP"]).optional(),
        packageName: z.string().trim().min(1).max(224).optional(),
        signatureHash: z.string().trim().length(11).optional(),
    })
    .superRefine((val, ctx) => {
        const buttons = val.buttons ?? [];
        const urlCount = buttons.filter((b) => b.type === "URL").length;
        const phoneCount = buttons.filter((b) => b.type === "PHONE_NUMBER").length;
        const copyCount = buttons.filter((b) => b.type === "COPY_CODE").length;
        if (urlCount > 2) {
            ctx.addIssue({ code: "custom", path: ["buttons"], message: "max_two_url_buttons" });
        }
        if (phoneCount > 1) {
            ctx.addIssue({ code: "custom", path: ["buttons"], message: "max_one_phone_button" });
        }
        if (copyCount > 1) {
            ctx.addIssue({ code: "custom", path: ["buttons"], message: "max_one_copy_code" });
        }

        if (val.category === "AUTHENTICATION") {
            if (val.headerText || val.footerText || val.bodyText || buttons.length > 0 || val.offerText) {
                ctx.addIssue({ code: "custom", path: ["category"], message: "auth_preset_only" });
            }
            if (val.otpType === "ONE_TAP" && (!val.packageName || !val.signatureHash)) {
                ctx.addIssue({ code: "custom", path: ["packageName"], message: "android_app_required" });
            }
            return;
        }

        if (!val.bodyText?.trim()) {
            ctx.addIssue({ code: "custom", path: ["bodyText"], message: "body_required" });
        }
        const limited = val.category === "MARKETING" && val.marketingKind === "limited_time_offer";
        if (limited) {
            if (!val.offerText) {
                ctx.addIssue({ code: "custom", path: ["offerText"], message: "offer_text_required" });
            }
            if (val.headerText || val.footerText) {
                ctx.addIssue({ code: "custom", path: ["footerText"], message: "limited_offer_has_no_footer" });
            }
            if (buttons.some((button) => button.type !== "COPY_CODE" && button.type !== "URL")) {
                ctx.addIssue({ code: "custom", path: ["buttons"], message: "limited_offer_buttons" });
            }
            return;
        }
        if (val.category === "UTILITY" && val.marketingKind === "limited_time_offer") {
            ctx.addIssue({ code: "custom", path: ["marketingKind"], message: "limited_offer_is_marketing" });
        }
        if (val.headerText?.includes("{{") && !val.headerExample?.trim()) {
            ctx.addIssue({ code: "custom", path: ["headerExample"], message: "header_example_required" });
        }
    });

export type SubmitWhatsappTemplateBody = z.infer<typeof SubmitWhatsappTemplateBodySchema>;
export type TemplateButton = z.infer<typeof TemplateButtonSchema>;
