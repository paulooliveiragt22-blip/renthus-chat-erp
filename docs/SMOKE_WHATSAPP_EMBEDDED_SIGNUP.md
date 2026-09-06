# Smoke — WhatsApp Embedded Signup + Coexistence

Pré: App Live, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `NEXT_PUBLIC_META_APP_ID` (ou `META_APP_ID`), webhook com `messages` + `account_update` + `history` + `smb_app_state_sync` + `smb_message_echoes`.

1. Owner (feature `whatsapp_messages`) → Configurações → Canais → **Conectar WhatsApp**.
2. No popup, escolha o número do **WhatsApp Business** do celular.
3. Badge **Conectado · celular**. Health → OK.
4. Cliente manda pedido (ex. “2 heineken”) → bot monta carrinho (igual hoje).
5. Lojista responde **no celular** → bolha humana na inbox; bot pausa; carrinho **não** muda.
6. Conta **sem role no App** completa o fluxo (prova Advanced Access).
7. Member/driver → APIs 403.
8. `PUT /api/admin/whatsapp-channel` com token → 410.
9. DevTools: sem bloqueio CSP de `connect.facebook.net` / dialog Facebook.

ADR: [`ADR/0010-whatsapp-embedded-signup-coexistence.md`](./ADR/0010-whatsapp-embedded-signup-coexistence.md).
