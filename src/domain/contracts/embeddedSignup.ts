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

export function isCoexistenceFinishEvent(event: string): boolean {
    return event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
}
