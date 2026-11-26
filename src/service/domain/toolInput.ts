import { z } from "zod";

export const listFreeSlotsInput = z.object({
    offering_id: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});

export const proposeSlotInput = z.object({
    offering_id: z.string().uuid(),
    starts_at: z.string().min(16),
});

export const appointmentIdInput = z.object({
    appointment_id: z.string().uuid(),
});

export const rescheduleInput = appointmentIdInput.extend({
    starts_at: z.string().min(16),
});

export const proposeCaseInput = z.object({
    title: z.string().trim().min(1).max(80),
    summary: z.string().max(500).optional(),
});

export const saveVisitorInput = z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(8).max(20),
    interest: z.string().trim().min(1).max(80),
});

export const respondInput = z.object({
    reply_text: z.string().max(1000),
});
