# Meta App Review — WhatsApp Tech Provider (roteiro Renthus)

Use este roteiro com o app em ambiente onde o canal WA da empresa de teste já tem
`phone_number_id`, **WABA ID** e token válidos (Configurações → **Canais**).

Plano da empresa de teste: **Pro** ou **Market** (feature `whatsapp_templates_broadcast`).

---

## 1) `whatsapp_business_management`

### A) Coleção Postman da Meta (obrigatório)

1. No modal do App Review, abra a coleção Postman publicada.
2. Configure token + WABA ID do App.
3. Execute os requests indicados.
4. Aguarde até **24h** para aparecerem no formulário de App Review.

### B) Vídeo no produto Renthus

1. Login owner/admin → **Templates WA** (`/templates`).
2. Preencha nome snake_case, idioma `pt_BR`, categoria **UTILITY**, corpo com `{{1}}`/`{{2}}` e exemplos.
3. Clique **Enviar para aprovação**.
4. Mostre o status **PENDING** na lista.
5. (Opcional) Clique **Sincronizar da Meta**.

Alternativa/complemento: criar o mesmo modelo no WhatsApp Manager (botão do modal Meta).

---

## 2) `whatsapp_business_messaging`

1. Peça ao número de teste mandar “oi” (abre janela 24h).
2. Abra **WhatsApp** (`/whatsapp`) no Renthus.
3. Responda com texto livre **ou** use **Enviar template (HSM)** se o modelo já estiver APPROVED.
4. Grave tela do Renthus enviando + celular recebendo a mesma mensagem.

---

## 3) Checklist rápido antes de gravar

- [ ] Webhook `/api/whatsapp/incoming` configurado no App
- [ ] `CREDENTIALS_ENCRYPTION_KEY` definida
- [ ] Canal ativo em Configurações → Canais (com **WABA ID**)
- [ ] Empresa no plano Pro ou Market
- [ ] Número de teste na allowlist do App (enquanto Advanced Access pendente)

---

## Fora deste roteiro

- Embedded Signup (só após Tech Provider + produto liberado no App)
- Campanhas em massa (fase T2 — exige consentimento)
