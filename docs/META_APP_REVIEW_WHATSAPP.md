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
2. Preencha nome snake_case, idioma `pt_BR`, categoria **UTILITY**.
3. Opcional no vídeo: header texto, rodapé e até 3 botões (resposta rápida / URL / telefone).
4. Corpo com `{{1}}`/`{{2}}` + exemplos → **Enviar para aprovação**.
5. Mostre o status **PENDING** na lista (e `rejection_reason` se rejeitado após sync).
6. Clique **Sincronizar da Meta** para atualizar PENDING → APPROVED/REJECTED.

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

### Palavras de consentimento (WhatsApp)

| Texto do cliente | Efeito |
|------------------|--------|
| `PARAR` / `SAIR` / `STOP` / `CANCELAR` | Opt-out marketing |
| `QUERO OFERTAS` / `QUERO PROMOÇÕES` | Opt-in marketing |

Templates **MARKETING** só enviam se o cliente tiver opt-in.
