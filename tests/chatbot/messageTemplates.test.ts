import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    applyChatbotMessageTemplate,
    buildWelcomeMenuBody,
    DEFAULT_CHATBOT_MESSAGE_TEMPLATES,
    resolveChatbotMessageTemplates,
} from "../../lib/chatbot/messageTemplates";

describe("chatbot messageTemplates", () => {
    it("usa defaults quando config vazia", () => {
        const t = resolveChatbotMessageTemplates({});
        assert.equal(t.msg_welcome_returning, DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_welcome_returning);
        assert.equal(t.msg_thank_you, DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_thank_you);
    });

    it("respeita override e legado pro_greeting_routine", () => {
        const t = resolveChatbotMessageTemplates({
            pro_greeting_routine: "Oi de novo na {empresa}",
            msg_out_for_delivery: "Saiu!{nome_parte}",
        });
        assert.equal(t.msg_welcome_returning, "Oi de novo na {empresa}");
        assert.equal(t.msg_out_for_delivery, "Saiu!{nome_parte}");
    });

    it("welcome body usa saudação padrão sem anexos extras", () => {
        const body = buildWelcomeMenuBody(true, {
            ...DEFAULT_CHATBOT_MESSAGE_TEMPLATES,
            msg_welcome_returning: "Bem-vindo custom",
        });
        assert.equal(body, "Bem-vindo custom");
        assert.ok(!body.includes("btn_"));
    });

    it("aplica placeholders de nome", () => {
        const withName = applyChatbotMessageTemplate(
            DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_out_for_delivery,
            { customerName: "Maria" }
        );
        assert.ok(withName.includes(", Maria"));
        const noName = applyChatbotMessageTemplate(
            DEFAULT_CHATBOT_MESSAGE_TEMPLATES.msg_out_for_delivery,
            { customerName: "" }
        );
        assert.ok(!noName.includes(", "));
    });
});
