import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { migrateButtonLabel } from "../../lib/channels/migrateWhatsappLabel";

describe("migração de WhatsApp entre perfis", () => {
    it("o botão nomeia o modo de origem e o de destino", () => {
        assert.equal(migrateButtonLabel("delivery", "service"), "Migrar de Delivery para Serviço");
        assert.equal(migrateButtonLabel("service", "delivery"), "Migrar de Serviço para Delivery");
    });

    it("a rota não lê company_id do body e não mexe em conversa", () => {
        const root = process.cwd();
        const route = readFileSync(
            join(root, "app/api/admin/whatsapp-channel/migrate/route.ts"),
            "utf8"
        );
        const move = readFileSync(join(root, "lib/channels/migrateWhatsappChannel.ts"), "utf8");
        assert.match(route, /requireCompanyPlanFeature\(\s*["']whatsapp_messages["']/);
        assert.doesNotMatch(route, /body\.companyId|body\.company_id/);
        assert.doesNotMatch(move, /whatsapp_threads|whatsapp_messages/);
        assert.match(move, /migrated_out/);
        assert.match(move, /listAdministeredWhatsappChannels/);
        assert.match(route, /channelId/);
        assert.doesNotMatch(
            move.slice(move.indexOf("listAdministeredWhatsappChannels")),
            /encrypted_access_token/
        );
    });
});