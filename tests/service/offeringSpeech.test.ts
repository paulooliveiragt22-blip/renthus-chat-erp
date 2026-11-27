import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executeServiceTurn } from "../../src/service/application/executeServiceTurn";
import { normalizeVisitorPhone, planCards, reaisFromCents, siteSalesStep, speakOfferings, whatsappPlanBubbles } from "../../src/service/domain/offeringSpeech";
import { toolsForTurn } from "../../src/service/domain/serviceTools";
import { CASE_STAGE_LABELS, type ServiceOfferingView, type ServiceProfileView } from "../../src/service/domain/types";

const OFFERINGS: ServiceOfferingView[] = [
    {
        id: "1",
        name: "Delivery Essencial mensal",
        description: null,
        durationMin: null,
        priceCents: 27900,
        linkUrl: null,
        linkLabel: null,
    },
    {
        id: "2",
        name: "Delivery Essencial anual",
        description: null,
        durationMin: null,
        priceCents: 267840,
        linkUrl: null,
        linkLabel: null,
    },
    {
        id: "3",
        name: "Atendimento mensal",
        description: null,
        durationMin: null,
        priceCents: 15900,
        linkUrl: null,
        linkLabel: null,
    },
    {
        id: "4",
        name: "Enterprise",
        description: null,
        durationMin: null,
        priceCents: null,
        linkUrl: null,
        linkLabel: null,
    },
];

describe("fala dos planos", () => {
    it("mostra reais e uma linha por plano", () => {
        assert.equal(reaisFromCents(27900), "R$ 279,00");
        assert.equal(reaisFromCents(119880), "R$ 1.198,80");
        const speech = speakOfferings(OFFERINGS);
        assert.match(speech, /Essencial mensal: R\$ 279,00 por mês/u);
        assert.match(speech, /Essencial anual: R\$ 223,20 por mês \(R\$ 2\.678,40 no ano\)/u);
        assert.match(speech, /Mensal: R\$ 159,00 por mês/u);
        assert.match(speech, /Enterprise: sob consulta/u);
        assert.match(speech, /Qual desses você tem interesse\?$/u);
        assert.equal(speech.includes("27,90"), false);
        assert.match(speech, /Essencial mensal: R\$ 279,00 por mês\n/u);
    });

    it("serviço avulso não vira mensalidade", () => {
        const speech = speakOfferings([
            {
                id: "9",
                name: "Corte",
                description: null,
                durationMin: 30,
                priceCents: 5000,
                linkUrl: null,
                linkLabel: null,
            },
        ]);
        assert.match(speech, /Corte: R\$ 50,00 · 30 min/u);
        assert.equal(speech.includes("por mês"), false);
    });

    it("aceita WhatsApp com DDD", () => {
        assert.equal(normalizeVisitorPhone("(65) 99999-8888"), "+5565999998888");
        assert.equal(normalizeVisitorPhone("123"), null);
    });
});

describe("contato do chat do site", () => {
    it("o canal site grava o visitante e manda o botão", async () => {
        const profile: ServiceProfileView = {
            preset: "servico",
            contextText: "",
            agendaEnabled: true,
            casesEnabled: true,
            cancelEnabled: false,
            rescheduleEnabled: false,
            timeZone: "America/Cuiaba",
            labels: CASE_STAGE_LABELS,
        };
        assert.equal(toolsForTurn(profile, "site").includes("save_visitor"), true);
        assert.equal(toolsForTurn(profile, "whatsapp").includes("save_visitor"), false);

        const ctas: string[] = [];
        let saved = "";
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "",
                text: "Ana, 65999998888, quero o mensal",
                messagingChannel: "site",
                humanHref: "https://wa.me/556692071285",
            },
            {
                data: {
                    loadProfile: async () => profile,
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
                    saveSiteContact: async (_company, _session, name, phone) => {
                        saved = `${name} ${phone}`;
                        return { ok: true, code: "ok" };
                    },
                },
                wallet: {
                    begin: async () => ({ allowed: true }),
                    settle: async () => undefined,
                    release: async () => undefined,
                },
                model: {
                    run: async (request) => {
                        await request.executeTool("save_visitor", {
                            name: "Ana",
                            phone: "65999998888",
                            interest: "Atendimento mensal",
                        });
                        return { replyText: "O botão abre o WhatsApp.", model: "test", inputTokens: 1, outputTokens: 1 };
                    },
                },
                reply: {
                    text: async () => undefined,
                    buttons: async () => undefined,
                    cta: async (_body, label, url) => {
                        ctas.push(`${label} ${url}`);
                    },
                },
                handover: { handoff: async () => undefined },
                trace: { record: async () => undefined },
            }
        );
        assert.equal(saved, "Ana +5565999998888");
        assert.match(ctas[0] ?? "", /Chamar no WhatsApp/u);
        assert.match(ctas[0] ?? "", /wa\.me\/556692071285/u);
        assert.match(ctas[0] ?? "", /Ana/u);
        assert.equal((ctas[0] ?? "").includes("65999998888"), false);
    });

    it("lista os planos em cards e ignora a conta errada do modelo", async () => {
        const texts: string[] = [];
        const cards: { title: string; options: { label: string }[] }[] = [];
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "",
                text: "quais planos vocês têm?",
                messagingChannel: "site",
                humanHref: "https://wa.me/556692071285",
            },
            salesPorts(texts, OFFERINGS, async () => "Essencial R$ 27,90 por mês, tudo num parágrafo.", undefined, [], cards)
        );
        assert.equal(texts[0], "Qual desses você tem interesse?");
        assert.equal((texts[0] ?? "").includes("27,90"), false);
        assert.equal(cards.find((card) => card.title === "Essencial")?.options.map((option) => option.label).join(","), "Mensal,Anual");
    });

    it("anual depois de atendimento não reabre todos os planos", () => {
        const rows = [
            ...OFFERINGS,
            {
                id: "5",
                name: "Atendimento anual",
                description: "Agente de IA no WhatsApp",
                durationMin: null,
                priceCents: 119880,
                linkUrl: null,
                linkLabel: null,
            },
        ];
        const step = siteSalesStep(
            "anual",
            rows,
            [
                { role: "user", text: "Quais planos vocês têm?" },
                { role: "assistant", text: "lista" },
                { role: "user", text: "atendimento interprise" },
            ],
            true
        );
        assert.equal(step?.kind, "benefits");
        assert.match(step && step.kind === "benefits" ? step.body : "", /99,90/);
        assert.equal((step && step.kind === "benefits" ? step.body : "").includes("Essencial"), false);
        const ambiguous = siteSalesStep("atendimento interprise", rows, [], true);
        assert.equal(ambiguous?.kind, "period");
        const shown = planCards(ambiguous?.kind === "period" ? ambiguous.rows : []);
        assert.deepEqual(shown.map((card) => card.title), ["Office", "Enterprise"]);
    });

    it("depois da escolha mostra benefícios e pede nome e WhatsApp", async () => {
        const texts: string[] = [];
        const offerings = OFFERINGS.map((row) =>
            row.name === "Atendimento mensal"
                ? { ...row, description: "Agente de IA no WhatsApp\nAgenda com confirmação no botão\nCard do serviço" }
                : row
        );
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "",
                text: "quero o atendimento mensal",
                messagingChannel: "site",
                humanHref: "https://wa.me/556692071285",
            },
            salesPorts(texts, offerings, async () => "custa 15 reais e é bom")
        );
        assert.match(texts[0] ?? "", /Agente de IA no WhatsApp\nAgenda com confirmação no botão/u);
        assert.match(texts[0] ?? "", /Me passa seu nome e seu WhatsApp com DDD\?/u);
        assert.equal((texts[0] ?? "").includes("15 reais"), false);
    });

    it("grava nome e WhatsApp da frase e manda o botão", async () => {
        const texts: string[] = [];
        const ctas: string[] = [];
        let saved = "";
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "44444444-4444-4444-8444-444444444444",
                phoneE164: "",
                text: "Ana 65999998888",
                messagingChannel: "site",
                humanHref: "https://wa.me/556692071285",
                priorTurns: [{ role: "user", text: "quero o atendimento mensal" }],
            },
            salesPorts(texts, OFFERINGS, async () => "anotado", (name, phone) => {
                saved = `${name} ${phone}`;
            }, ctas)
        );
        assert.equal(saved, "Ana +5565999998888");
        assert.match(texts[0] ?? "", /Continuar no WhatsApp/u);
        assert.match(ctas[0] ?? "", /wa\.me\/556692071285/u);
        assert.match(ctas[0] ?? "", /Atendimento/u);
        assert.equal((ctas[0] ?? "").includes("65999998888"), false);
        assert.equal((texts[0] ?? "").includes("empresa retorna"), false);
    });

    it("no WhatsApp cada plano abre o cadastro já escolhido", async () => {
        const texts: string[] = [];
        const ctas: string[] = [];
        const offerings = [
            { ...OFFERINGS[0]!, linkUrl: "https://app.zampell.com.br/signup?plano=essencial&periodo=month", linkLabel: "Ver oferta" },
            { ...OFFERINGS[1]!, linkUrl: "https://cadastro.exemplo/essencial-ano", linkLabel: "Ver oferta" },
            { ...OFFERINGS[2]!, linkUrl: "https://app.zampell.com.br/signup/office?periodo=month", linkLabel: "Ver plano" },
            OFFERINGS[3]!,
            {
                id: "5",
                name: "Atendimento anual",
                description: "Agente de IA no WhatsApp",
                durationMin: null,
                priceCents: 119880,
                linkUrl: "https://app.zampell.com.br/signup/office?periodo=year",
                linkLabel: "Ver oferta",
            },
        ];
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "+5565999998888",
                text: "quais planos vocês têm?",
                messagingChannel: "whatsapp",
            },
            salesPorts(texts, offerings, async () => "tudo num parágrafo difícil de ler", undefined, ctas)
        );
        assert.match(texts[0] ?? "", /Toque no botão/u);
        assert.equal((texts[0] ?? "").includes("parágrafo"), false);
        assert.match(ctas.join("\n"), /R\$ 279,00 por mês/u);
        assert.match(ctas.join("\n"), /Agente de IA no WhatsApp/u);
        assert.deepEqual(
            ctas.map((line) => line.split("\n")[0]),
            [
                "Ver oferta https://app.zampell.com.br/signup?plano=essencial&periodo=month Essencial mensal",
                "Ver oferta https://cadastro.exemplo/essencial-ano Essencial anual",
                "Ver plano https://app.zampell.com.br/signup/office?periodo=month Office mensal",
                "Ver oferta https://app.zampell.com.br/signup/office?periodo=year Office anual",
            ]
        );
        assert.match(texts.join("\n"), /Enterprise: sob consulta/u);
    });

    it("um plano no WhatsApp é uma mensagem com o botão", async () => {
        const texts: string[] = [];
        const ctas: string[] = [];
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "+5565999998888",
                text: "quero o atendimento mensal",
                messagingChannel: "whatsapp",
            },
            salesPorts(
                texts,
                [
                    {
                        ...OFFERINGS[2]!,
                        linkUrl: "https://app.zampell.com.br/signup/office?periodo=month",
                        linkLabel: "Ver plano",
                    },
                ],
                async () => "custa 15 reais",
                undefined,
                ctas
            )
        );
        assert.equal(texts.length, 0);
        assert.equal(ctas.length, 1);
        assert.match(ctas[0] ?? "", /Ver plano/u);
        assert.match(ctas[0] ?? "", /https:\/\/app\.zampell\.com\.br\/signup\/office\?periodo=month/u);
        assert.match(ctas[0] ?? "", /Office mensal/u);
        assert.equal((ctas[0] ?? "").includes("15 reais"), false);
    });

    it("serviço que não é plano continua em texto", async () => {
        const texts: string[] = [];
        const ctas: string[] = [];
        await executeServiceTurn(
            {
                admin: {} as never,
                companyId: "11111111-1111-4111-8111-111111111111",
                threadId: "22222222-2222-4222-8222-222222222222",
                messageId: "33333333-3333-4333-8333-333333333333",
                phoneE164: "+5565999998888",
                text: "quais os valores?",
                messagingChannel: "whatsapp",
            },
            salesPorts(
                texts,
                [
                    {
                        id: "9",
                        name: "Corte",
                        description: null,
                        durationMin: 30,
                        priceCents: 5000,
                        linkUrl: null,
                        linkLabel: null,
                    },
                ],
                async () => "é cinquenta",
                undefined,
                ctas
            )
        );
        assert.equal(ctas.length, 0);
        assert.match(texts[0] ?? "", /Corte: R\$ 50,00 · 30 min/u);
        assert.equal((texts[0] ?? "").includes("cinquenta"), false);
    });

    it("o botão usa o link cadastrado e some sem ele", () => {
        const [bubble] = whatsappPlanBubbles([
            {
                ...OFFERINGS[0]!,
                linkUrl: "https://cadastro.exemplo/essencial",
                linkLabel: "Ver plano",
            },
        ]);
        assert.equal(bubble?.kind, "cta");
        if (bubble?.kind === "cta") {
            assert.equal(bubble.label, "Ver plano");
            assert.equal(bubble.url, "https://cadastro.exemplo/essencial");
        }
        assert.equal(whatsappPlanBubbles([OFFERINGS[0]!]).some((item) => item.kind === "cta"), false);
        assert.equal(whatsappPlanBubbles([OFFERINGS[3]!]).some((item) => item.kind === "cta"), false);
    });
});

function salesPorts(
    texts: string[],
    offerings: ServiceOfferingView[],
    reply: () => Promise<string>,
    onSave?: (name: string, phone: string) => void,
    ctas: string[] = [],
    cards: { title: string; options: { label: string }[] }[] = []
) {
    return {
        data: {
            listFaqs: async () => [],
            loadProfile: async () => ({
                preset: "servico" as const,
                contextText: "",
                agendaEnabled: true,
                casesEnabled: true,
                cancelEnabled: false,
                rescheduleEnabled: false,
                timeZone: "America/Cuiaba",
                labels: CASE_STAGE_LABELS,
            }),
            listOfferings: async () => offerings,
            listFreeSlots: async () => ({ ok: true as const, code: "ok" as const, slots: [] }),
            proposeSlot: async () => ({ ok: true as const, code: "ok" as const }),
            listAppointments: async () => [],
            cancelAppointment: async () => ({ ok: false as const, code: "flag_off" as const }),
            rescheduleAppointment: async () => ({ ok: false as const, code: "flag_off" as const }),
            listOpenCases: async () => [],
            proposeCase: async () => ({ ok: true as const, code: "ok" as const }),
            confirmOpenSlot: async () => ({ ok: true as const, code: "ok" as const }),
            confirmOpenCase: async () => ({ ok: true as const, code: "ok" as const }),
            saveSiteContact: async (_company: string, _session: string, name: string, phone: string) => {
                onSave?.(name, phone);
                return { ok: true as const, code: "ok" as const };
            },
        },
        wallet: {
            begin: async () => ({ allowed: true }),
            settle: async () => undefined,
            release: async () => undefined,
        },
        model: {
            run: async () => ({ replyText: await reply(), model: "test", inputTokens: 1, outputTokens: 1 }),
        },
        reply: {
            text: async (body: string) => {
                texts.push(body);
            },
            buttons: async () => undefined,
            cta: async (body: string, label: string, url: string) => {
                ctas.push(`${label} ${url} ${body}`);
            },
            planCards: async (next: { title: string; options: { label: string }[] }[]) => {
                cards.splice(0, cards.length, ...next);
            },
        },
        handover: { handoff: async () => undefined },
        trace: { record: async () => undefined },
    };
}
