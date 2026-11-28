import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeServiceTurn } from "../../src/service/application/executeServiceTurn";
import {
    SITE_SUPPORT_ASK_NAME,
    SITE_SUPPORT_ASK_PHONE,
    siteSupportStep,
} from "../../src/service/domain/siteSupport";
import type { ServiceTurnPorts } from "../../src/service/ports/serviceTurnPorts";

describe("suporte do chat do site", () => {
    it("pede o nome e depois o WhatsApp", () => {
        assert.equal(
            siteSupportStep("Ana", [{ role: "assistant", text: SITE_SUPPORT_ASK_NAME }])?.kind,
            "ask_phone"
        );
        assert.equal(
            siteSupportStep("oi", [{ role: "assistant", text: SITE_SUPPORT_ASK_PHONE }])?.kind,
            "ask_phone"
        );
    });

    it("com nome e WhatsApp manda o botão", async () => {
        const texts: string[] = [];
        const buttons: string[] = [];
        let saved = "";
        const ports: ServiceTurnPorts = {
            data: {
                loadProfile: async () => ({
                    preset: "servico",
                    contextText: "",
                    agendaEnabled: false,
                    casesEnabled: false,
                    cancelEnabled: false,
                    rescheduleEnabled: false,
                    timeZone: "America/Cuiaba",
                    labels: { aberto: "Aberto", em_andamento: "Andamento", concluido: "Concluído", perdido: "Perdido" },
                }),
                listFaqs: async () => [],
                listOfferings: async () => [],
                listFreeSlots: async () => ({ ok: true, code: "ok", slots: [] }),
                proposeSlot: async () => ({ ok: true, code: "ok" }),
                listAppointments: async () => [],
                cancelAppointment: async () => ({ ok: false, code: "flag_off" }),
                rescheduleAppointment: async () => ({ ok: false, code: "flag_off" }),
                listOpenCases: async () => [],
                proposeCase: async () => ({ ok: true, code: "ok" }),
                confirmOpenSlot: async () => ({ ok: true, code: "ok" }),
                confirmOpenCase: async () => ({ ok: true, code: "ok" }),
                saveSiteContact: async (_company, _session, name, phone, interest) => {
                    saved = `${name} ${phone} ${interest}`;
                    return { ok: true, code: "ok" };
                },
            },
            wallet: { begin: async () => ({ allowed: true }), settle: async () => undefined, release: async () => undefined },
            model: { run: async () => { throw new Error("modelo não entra no meio do suporte"); } },
            reply: {
                text: async (body) => { texts.push(body); },
                buttons: async () => undefined,
                cta: async (_body, label, url) => { buttons.push(`${label} ${url}`); },
                planCards: async () => undefined,
            },
            handover: { handoff: async () => undefined },
            trace: { record: async () => undefined },
        };
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "",
                text: "65999990000",
                messagingChannel: "site",
                humanHref: "https://wa.me/556692071285",
                priorTurns: [
                    { role: "assistant", text: SITE_SUPPORT_ASK_NAME },
                    { role: "user", text: "Ana" },
                    { role: "assistant", text: SITE_SUPPORT_ASK_PHONE },
                ],
            },
            ports
        );
        assert.equal(saved, "Ana +5565999990000 Suporte");
        assert.match(buttons[0] ?? "", /Chamar no WhatsApp/u);
        assert.match(buttons[0] ?? "", /Ana/u);
        assert.equal((texts[0] ?? "").includes("wa.me"), false);
    });
});
