import { z } from "zod";

export const EMBEDDED_SIGNUP_EVENTS = [
    "FINISH",
    "FINISH_ONLY_WABA",
    "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
] as const;

export const embeddedSignupCompleteBodySchema = z.object({
    code: z.string().trim().min(8).max(2048),
    event: z.enum(EMBEDDED_SIGNUP_EVENTS),
    wabaId: z.string().trim().min(5).max(64),
    phoneNumberId: z.string().trim().min(5).max(64).optional(),
    displayPhone: z.string().trim().max(32).nullable().optional(),
    pin: z
        .string()
        .trim()
        .regex(/^\d{6}$/)
        .optional(),
});

export type EmbeddedSignupCompleteBody = z.infer<typeof embeddedSignupCompleteBodySchema>;

export const whatsappTenantPasteBodySchema = z
    .object({
        phoneNumberId: z.string().trim().min(5).max(64),
        accessToken: z.string().trim().min(20).max(4096),
        wabaId: z
            .string()
            .trim()
            .max(64)
            .optional()
            .refine((value) => value == null || value.length === 0 || value.length >= 5),
        displayPhone: z.string().trim().max(32).optional(),
    })
    .strict();

export type WhatsappTenantPasteBody = z.infer<typeof whatsappTenantPasteBodySchema>;

export const whatsappMigrateByIdSchema = z
    .object({
        channelId: z.string().uuid(),
    })
    .strict();

export function isCoexistenceFinishEvent(event: string): boolean {
    return event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
}
