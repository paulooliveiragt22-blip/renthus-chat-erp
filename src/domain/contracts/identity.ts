/**
 * Contratos de identidade omnichannel (Zod).
 * Fonte: docs/PLANO_LIMPEZA_AGENTE_IA.md §9.1 / §7.10
 */

import { z } from "zod";

export const MessagingChannelSchema = z.enum([
    "whatsapp",
    "instagram",
    "messenger",
    "web",
]);
export type MessagingChannel = z.infer<typeof MessagingChannelSchema>;

export const PhoneE164Schema = z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "phone_e164_invalid")
    .brand<"PhoneE164">();
export type PhoneE164 = z.infer<typeof PhoneE164Schema>;

export const IgSidSchema = z.string().min(5).brand<"IgSid">();
export type IgSid = z.infer<typeof IgSidSchema>;

export const MessengerPsidSchema = z.string().min(5).brand<"MessengerPsid">();
export type MessengerPsid = z.infer<typeof MessengerPsidSchema>;

export const CustomerIdSchema = z.string().uuid().brand<"CustomerId">();
export type CustomerId = z.infer<typeof CustomerIdSchema>;

export const CompanyIdSchema = z.string().uuid().brand<"CompanyId">();
export type CompanyId = z.infer<typeof CompanyIdSchema>;

export const ChannelIdentitySchema = z.discriminatedUnion("channel", [
    z.object({
        channel: z.literal("whatsapp"),
        externalId: z.string().min(8),
    }),
    z.object({
        channel: z.literal("instagram"),
        externalId: IgSidSchema,
    }),
    z.object({
        channel: z.literal("messenger"),
        externalId: MessengerPsidSchema,
    }),
    z.object({
        channel: z.literal("web"),
        externalId: z.string().min(1),
    }),
]);
export type ChannelIdentity = z.infer<typeof ChannelIdentitySchema>;

export const ResolveIdentityResultSchema = z.object({
    customerId: CustomerIdSchema,
    isNew: z.boolean(),
    needsPhone: z.boolean(),
});
export type ResolveIdentityResult = z.infer<typeof ResolveIdentityResultSchema>;

export const LinkPhoneResultSchema = z.object({
    customerId: CustomerIdSchema,
    merged: z.boolean(),
    fromCustomerId: CustomerIdSchema.nullable(),
});
export type LinkPhoneResult = z.infer<typeof LinkPhoneResultSchema>;
