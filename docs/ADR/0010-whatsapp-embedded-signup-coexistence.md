# ADR 0010 — WhatsApp Embedded Signup + Coexistence (Tech Provider)

**Status:** aceito — C6.1–C6.7 implementados (C6.0 ops Meta pendente no dashboard; C6.8 disconnect D11 especificado, código não entregue)  
**Data:** 2026-09-06  
**Aprovação produto:** dono, 2026-09-06 (App Review `whatsapp_business_messaging` + `whatsapp_business_management` aprovados)  
**Checklist:** [`CHECKLIST_WHATSAPP_EMBEDDED_SIGNUP.md`](../CHECKLIST_WHATSAPP_EMBEDDED_SIGNUP.md)  
**Predecessor:** [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](../CHECKLIST_CANAIS_WABA_IG_MESSENGER.md) (C0–C5; D9 adiado)  
**Env:** [`ENV_META_CHANNELS.md`](../ENV_META_CHANNELS.md)  
**App Review (histórico):** [`META_APP_REVIEW_WHATSAPP.md`](../META_APP_REVIEW_WHATSAPP.md)

**Escopo comercial:** **não** muda preço, trial, `plan_features` nem feature keys. Gate existente: `whatsapp_messages` (conectar canal). Templates/campanhas continuam em `whatsapp_templates_broadcast`.

---

## Contexto

O lojista hoje cola Phone Number ID + token em Configurações → Canais (`provisioning_mode = tenant_paste`). Isso **só funciona** se o número/token forem do **mesmo Meta App** do webhook da plataforma. Cliente que cria App isolado “salva” e o inbound não chega.

O App Renthus é **Tech Provider** com Advanced Access das duas permissões WhatsApp. O produto oficial da Meta para o lojista conectar sozinho é o **Embedded Signup** (Facebook Login for Business + JS SDK). A coluna `whatsapp_channels.provisioning_mode` já reserva `'embedded_signup'`; não há UI nem complete server-side.

Decisão de produto (2026-09-06): o lojista típico (distribuidora/bebidas) **não quer perder o WhatsApp Business do celular**. Isso é **Coexistence** (onboarding de número já no app Business), oficial para Tech Provider — não é Cloud API exclusivo.

---

## Decisão

### D1 — Conexão tenant = Embedded Signup

Botão **Conectar WhatsApp** na aba Canais. O browser só lança `FB.login` e junta `code` + `sessionInfo`. O **servidor** troca o code (app secret), valida escopos, assina a WABA e persiste via `upsertWhatsappChannelCredentials` com `provisioning_mode = embedded_signup`.

Token BISU **nunca** no browser, nunca em `provider_metadata` plaintext (AES `CREDENTIALS_ENCRYPTION_KEY`, já obrigatório em prod).

### D2 — Coexistence default + Cloud API puro como fallback

| Caminho | Quando | `FB.login` extras | Register phone |
|---------|--------|-------------------|----------------|
| **Coexistence (default)** | Lojista tem WhatsApp Business ≥ 2.24.17 no número | `featureType: "whatsapp_business_app_onboarding"`, `sessionInfoVersion: "3"` | **Não** chamar `/{phone}/register` |
| **Cloud API puro** | Número novo / sem app / Coexistence inelegível | `setup: {}` sem `featureType` de app | `POST /{phone}/register` com PIN |

A Meta mostra as duas telas no mesmo config se o Login for Business estiver no template Embedded Signup. Evento de sessão:

- Coexistence: `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (payload frequentemente **só** `waba_id` — phone id via Graph `/{waba_id}/phone_numbers`)
- Cloud API: `FINISH` com `waba_id` + `phone_number_id`

Um único `POST …/embedded-signup/complete` distingue pelo `event` / `is_on_biz_app`.

### D3 — Paste some da UI do lojista

`PUT /api/admin/whatsapp-channel` com token colado **não** fica na aba Canais. Platform/suporte continua provisionando (D4 do épico Canais). Sem dual-path “colar ou clicar” no tenant.

### D4 — Carrinho e pedido: só inbound do **cliente** + bot (ou inbox)

**Pergunta fechada nesta ADR:** mensagem que o lojista **responde no WhatsApp Business do celular** **não** cria/atualiza carrinho nem fecha pedido.

Fonte canônica do carrinho automático:

```text
cliente → webhook field=messages → chatbot_queue → processMessage / runProInbound
        → session.cart / prepare_order_draft → (opcional) create_order_with_items
```

| Origem | Persiste na inbox? | Enfileira bot? | Mexe no carrinho? |
|--------|--------------------|----------------|-------------------|
| Texto/áudio/botão do **cliente** (`messages`) | Sim (`inbound`, customer) | Sim, se `bot_active` | **Sim** — pipeline PRO |
| Resposta do **bot** (Cloud API outbound) | Sim (`outbound`, `sender_type=bot`) | Não | Não |
| Atendente no **inbox Renthus** | Sim (`outbound`, `human`) | Não (handover) | Só se editar o modal de carrinho |
| Eco do **celular** (`smb_message_echoes`) | Sim (`outbound`, `human`) | **Não** | **Não** |
| Histórico 6 meses (`history`) | Sim (espelho) | **Não** | **Não** |

Eco do celular: persistir + `bot_active=false` + `handover_at=now()` na thread (evita bot e lojista respondendo juntos). O lojista monta/fecha pedido no **inbox** (`CartEditModal` / fluxo humano já existente), não pelo texto digitado no app.

**Fora deste épico (produto novo):** NLP do texto do lojista no celular → draft de pedido. Sem isso no C6.

### D5 — Sync Coexistence em 24h, só espelho

Após Coexistence, chamar `POST /{phone_number_id}/smb_app_data` (`sync_type` contacts + history) **dentro de 24h**. Webhooks `history` e `smb_app_state_sync` só hidratam inbox/contatos. Sem reprocessar histórico no agente (evita pedido fantasma).

### D6 — Config Login for Business **separado** do IG/Messenger

`META_LOGIN_CONFIG_ID` continua só Page/IG. Embedded Signup usa `META_EMBEDDED_SIGNUP_CONFIG_ID` (server) + `NEXT_PUBLIC_META_APP_ID` (SDK). Permissões da Configuration: **somente** `whatsapp_business_management` + `whatsapp_business_messaging`. Token: BISU **sem expiração**.

### D7 — Webhook único da plataforma

Callback continua `/api/whatsapp/incoming`. Além de `messages`, assinar no App:

- `account_update` (`PARTNER_ADDED` — reconciliação se o complete() falhou)
- `history`, `smb_app_state_sync`, `smb_message_echoes` (Coexistence)

Subscribe por WABA: `POST /{waba_id}/subscribed_apps` no complete (obrigatório; webhook de App sozinho não entrega o tenant).

### D8 — CSP (S10) não pode quebrar o SDK

`buildContentSecurityPolicy` hoje tem `connect-src` com `graph.facebook.com` e **sem** `frame-src`. Embedded Signup exige:

- carregar `connect.facebook.net/en_US/sdk.js` (ou `pt_BR`) com **nonce** do layout (`strict-dynamic` cobre o follow-up do SDK)
- `connect-src` + `https://www.facebook.com` `https://web.facebook.com` `https://connect.facebook.net`
- `frame-src` `https://www.facebook.com` `https://web.facebook.com` (dialog)

Sem abrir `script-src 'unsafe-inline'`. Testes CSP existentes precisam continuar verdes.

### D9 — Quem conecta / gate

Igual Canais: `owner` / `admin` + `requirePlanFeature(..., "whatsapp_messages")`. `company_id` só da sessão. Rota nova no inventário B15 (`SECURITY_CREATEADMIN_INVENTORY.md`).

### D11 — Desconectar = wipe + unsubscribe (sem dual-path de pausa)

O lojista desconecta na aba Canais. **Não** é o `PATCH status=inactive` atual (token fica no banco; webhook ainda pode chegar).

| Peça | Comportamento |
|------|----------------|
| Token AES | Zera. Sem credencial, sem envio e sem health. |
| App na WABA | `DELETE /{waba_id}/subscribed_apps` (best-effort com o token ainda válido). |
| Celular / WABA | **Não** mexe. Sem `/{phone}/deregister`, sem apagar WABA na Meta. |
| Inbox / pedidos | Permanecem. Só o canal para. |
| Reconectar | Mesmo **Conectar WhatsApp** (Embedded Signup). |

**Some** Desativar/Reativar na UI do tenant (pré-produção radical: um verbo só). Soft-pause com ciphertext órfão não fica.

Quem: `owner` / `admin` + `whatsapp_messages`. `company_id` só da sessão. Audit `disconnected`.

---

## Estrutura (Clean Architecture nesta stack)

```text
Presentation
  components/channels/WhatsAppEmbeddedSignupButton.tsx
  components/channels/ChannelsSettings.tsx          # botão primário; some o paste

API
  app/api/admin/whatsapp-channel/embedded-signup/config/route.ts     # GET appId + flags (sem secret)
  app/api/admin/whatsapp-channel/embedded-signup/complete/route.ts   # POST code + session
  app/api/admin/whatsapp-channel/route.ts                            # GET; PUT 410; DELETE disconnect (D11)

Application
  lib/channels/completeWhatsappEmbeddedSignup.ts
  lib/channels/exchangeEmbeddedSignupCode.ts
  lib/channels/subscribeWabaToApp.ts
  lib/channels/unsubscribeWabaFromApp.ts            # DELETE subscribed_apps (D11)
  lib/channels/disconnectWhatsappChannel.ts         # decrypt → unsubscribe → wipe → audit
  lib/channels/registerCloudApiPhone.ts             # só caminho puro
  lib/channels/startCoexistenceDataSync.ts
  lib/channels/upsertWhatsappChannelCredentials.ts  # aceitar provisioning_mode embedded_signup

Inbound
  app/api/whatsapp/incoming/route.ts                # fields extras; não enqueue echo/history

CSP
  lib/security/cspPolicy.ts
```

Elite de mercado: o mesmo padrão do OAuth Page (`oauth/start` + `callback`), com a diferença de que a Meta **exige** JS SDK + `postMessage` para devolver WABA/phone. Exchange e subscribe ficam no server, como o `exchangePageOAuth` já faz para IG.

---

## Consequências

- Lojista conecta sem criar App Meta nem colar token; inbound chega no App da plataforma.
- Celular e SaaS convivem; handover por eco evita double-reply.
- Carrinho automático **não** acompanha o que o lojista digita no app — só o que o **cliente** pede ao bot (ou o atendente edita no inbox).
- Número já 100% Cloud API **não** volta para Coexistence (limitação Meta).
- Ops: Configuration ID + App Live + webhook fields + domains no Login + **Login com o SDK do Javascript = Sim** — sem isso o popup abre e a Meta recusa o JSSDK.
- Desconectar (D11) tira a Renthus do número; o WhatsApp Business no celular continua. Reconectar é Embedded Signup de novo.
- Embedded Signup v2 deprecia em **2026-10-15**; implementação já em **v4** (`sessionInfoVersion: "3"`).
