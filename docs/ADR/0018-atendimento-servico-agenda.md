# ADR 0018 — Atendimento de serviço: motor ao lado do delivery

**Status:** aceito (2026-11-25) — emenda 2026-11-26: chat do site na vitrine, no mesmo turno, sem agenda. Emenda 2026-11-26, à tarde: a página pública de atendimento tem tabela própria (D10) e ainda não entra no billing. Emenda 2026-11-27: a agenda do Google entra no painel do Office (D11). O Postgres continua a fonte do horário. Workers publicados em 2026-11-25: `renthus-inbound-worker:live` versão 100. Emenda 2026-11-27, à noite: a vitrine pública do Office fica oculta (`OFFICE_LANDING_VISIBLE`). Página, checkout e painel permanecem. O Office, por enquanto, atende a própria Zampell enquanto ela vende o Delivery.
**Data:** 2026-11-25
**Aprovação do dono:** 2026-11-25, de manhã (mesmo repositório; WhatsApp é o canal; inbox, templates, campanhas e Embedded Signup são reaproveitados; motor de serviço ao lado do delivery). Emenda 2026-11-25, à tarde: a estrutura superior substitui o miolo. O modelo propõe a marcação nova; o botão ou o balcão confirma; a inserção é uma função só. Emenda 2026-11-25, em seguida: cancelar e remarcar entram nas ferramentas do WhatsApp, cada um com interruptor da empresa. Os dois nascem desligados. Emenda 2026-11-25, fim da tarde: no cadastro a empresa escolhe um modelo (horário, serviço, consulta e caso, balcão). Isso liga agenda e card. As etapas do card são quatro, fixas. O rótulo pode mudar. O funil não. Emenda 2026-11-25, em seguida: o checklist de implementação passa a travar UI, contrato tipado e as rules do repositório, para o corte de código não reabrir decisão.
**Escopo técnico:** um segundo motor de atendimento, no mesmo webhook, na mesma fila e no mesmo número. A empresa escolhe o modo no cadastro. O modo serviço responde com o contexto da empresa e marca horário. O modo delivery continua em `src/pro`.
**Escopo comercial:** o motor não cria plano, preço, feature key nem cota. Quem entra em serviço usa as features que já liberam WhatsApp (`whatsapp_messages`, `whatsapp_templates_broadcast`) e a mesma carteira de IA. A oferta pública da página está em D10 e não grava `plans`. Sem ficha, sem prontuário, sem vários profissionais, sem pagamento da consulta e sem entrega.
**Relacionados:** [`ADR/0003`](./0003-sqs-outbox-lambda.md) (fila), [`ADR/0005`](./0005-pro-agent-calibration-pillars.md) (o modelo interpreta, o servidor decide), [`ADR/0010`](./0010-whatsapp-embedded-signup-coexistence.md) (número), [`ADR/0013`](./0013-pro-sellable-attendant.md) (boca do servidor), [`ADR/0016`](./0016-consumo-ia-corte-e-media-por-empresa.md) (carteira)
**Governança:** `governanca-seguranca-negocio.mdc`, `supabase-migrations-seguranca.mdc`, `projeto-pre-producao-radical.mdc`, `decisoes-negocio-antes-codigo.mdc`, `arquitetura-lider.mdc`, `agente-pro-hexagonal.mdc`, `api-createadmin-gate.mdc`, `ui-expert.mdc`

Leitura do banco remoto `zwcfuvohxmvlxhdfbgxo` em 2026-11-25. A trava de horário sobreposto segue o guia de colunas range do Supabase (extensão `btree_gist` e `EXCLUDE` com `tstzrange`). RLS e `SECURITY DEFINER` seguem o checklist deste repositório (`search_path = public, pg_temp`, `REVOKE` de `PUBLIC`).

### O que a emenda troca

A primeira redação guardava a vaga pendente em `chatbot_sessions.context` e deixava o modelo chamar a marcação nova. Isso cai. A vaga oferecida é uma linha (`service_slot_offers`). Marcar horário novo não é ferramenta do modelo. Cancelar e remarcar são, e só quando a empresa liga o interruptor daquele ato no WhatsApp. O balcão marca, cancela e remarca com ou sem esse interruptor. Clínica, oficina, serralheria e escritório não ganham funis diferentes: o cadastro liga agenda, card, ou os dois, e o card usa as mesmas quatro etapas. A inbox não esconde o carrinho no mesmo arquivo: o trilho da direita é outro componente, e o layout do admin recusa a URL de delivery.

---

## Contexto

O inbound já resolve a empresa pelo número e não sabe o que a empresa vende.

```text
WhatsApp Cloud API
  → POST /api/whatsapp/incoming
  → whatsapp_messages (unique provider + provider_message_id)
  → chatbot_queue
  → processInboundMessage
  → runProInbound → src/pro
```

`processInboundMessage` só chama o motor de delivery. Eco do WhatsApp Business (`smb_message_echoes`) já não entra nessa fila. O motor de serviço não trata eco.

O gargalo não é o webhook. A mensagem já deduplica e cai na fila. O gargalo é o turno: quem grava o horário, e se a sessão jsonb aguenta ser a fonte desse horário. Não aguenta. A sessão expira em duas horas e o motor de delivery regrava a linha.

O que já existe e não muda de tabela:

| Peça | Onde está hoje | O que o modo serviço faz com ela |
|---|---|---|
| Número | `whatsapp_channels` — um canal ativo por `company_id`; `provisioning_mode` já aceita `platform`, `tenant_paste`, `embedded_signup`; unique `(provider, from_identifier)` | A aba Canais é a mesma nos dois modos: Embedded Signup ou credenciais coladas. O mesmo número não migra sozinho: a tela avisa e só o botão move o canal. As conversas ficam na empresa de origem. O webhook continua achando a empresa pelo número. |
| Conversa | `whatsapp_threads` (`bot_active`, `handover_at`, `last_inbound_at`) e `whatsapp_messages` | A lista e as bolhas da inbox continuam. O trilho da direita, no modo serviço, não busca carrinho nem pedido. |
| Fila | `chatbot_queue` e `outbound_jobs` (`unique (company_id, dedup_key)`) | O turno entra na mesma fila, com teto de 4 rodadas de ferramenta. O lembrete, numa fatia seguinte, entra na mesma outbox. |
| Pessoa | `customers` unique `(company_id, phone_e164)` e `customer_channel_identities` unique `(company_id, channel, external_id)` | Quem fala no WhatsApp já vira cliente. A agenda aponta para esse `customer_id`. `origem = 'whatsapp'` já é válido. |
| Horário da casa | `company_settings.opening_periods` (até 2 turnos `{open, close}`), `timezone` default `America/Cuiaba` | A grade lê esses turnos. A função SQL cobre o turno que passa da meia-noite com os mesmos exemplos de `lib/delivery/hours.ts`. Essa função de “loja aberta” do delivery não muda. |
| Endereço da casa | `companies.endereco`, `numero`, `bairro`, `cidade`, `uf`, `phone`, `whatsapp_phone` | O agente informa o que já está no cadastro. |
| Template | `whatsapp_message_templates` (espelho da Meta, por `waba_id`) | A tela Templates fica. O lembrete é um template `UTILITY` dessa tabela, quando a Meta aprovar. |
| Campanha | `broadcast_campaigns.audience_filter` jsonb + `broadcast_campaign_recipients` + opt-in em `customer_message_consents` | A tela Campanhas fica. O filtro `all_with_phone` já serve. `ordered_last_days` só aparece no delivery. Marketing continua exigindo opt-in. |
| Repasse | `applyProHandover` grava `bot_active`, `handover_at` e `support_tickets` | Os dois motores chamam a mesma função, movida para `lib/chatbot/handover.ts`. Uma frase sem esse update não é handover. |
| Crédito de IA | `company_ai_wallets` / ledger (ADR 0016) | Reserva antes da chamada, no mesmo adapter. Sem saldo, frase fixa, sem modelo. Botão de horário não debita. |
| Sessão | `chatbot_sessions` (`cart`, `context`, `history`) | O serviço não escreve `cart` nem guarda vaga em `context`. |

O que o banco não tem: modo da empresa, texto do que a empresa faz, oferta, vaga oferecida e horário marcado. `btree_gist` já está instalado. `outbound_jobs.purpose` só aceita `cart_recovery`, `reengagement`, `promo`, `transactional`, `broadcast_template`. As 37 empresas atuais são delivery; o default do modo novo é `delivery`.

`opening_periods` não tem dia da semana. Sem turno cadastrado, o delivery trata a loja como aberta. Na agenda isso marcaria qualquer hora. A marcação de serviço recusa empresa sem turno.

Decisão do dono em 2026-11-27: o painel pode gravar um evento sem oferta. A duração, nesse caso, é 15, 30 ou 60 minutos e o fim é calculado no banco. O WhatsApp continua marcando só em cima de uma oferta. O expediente do atendimento fica em `service_profiles.attendance_windows` (até dois turnos `{dow, open, close}` por dia da semana). É essa janela que o painel e o WhatsApp consultam antes de marcar. Não é o `opening_periods` da loja e não é a grade visual. A grade mostra o dia inteiro, 00:00–24:00, no mesmo recorte de um evento com hora do Google Agenda. Sem janelas salvas, a marcação continua no `opening_periods`. Com janelas salvas, um dia sem turno fica fechado.

A policy `service_role_only` fecha o browser. O worker usa `service_role` e ignora essa policy. Quem isola a empresa é a função.

---

## Decisão

### D1 — Um modo na empresa, lido no único desvio

`companies.attendance_mode text not null default 'delivery'`

`CHECK (attendance_mode in ('delivery', 'service'))`

As empresas que já existem recebem `delivery`. O cadastro grava o valor escolhido. Não fica em `companies.settings` jsonb.

```text
processInboundMessage
  attendance_mode = delivery → runProInbound
  attendance_mode = service  → runServiceTurn
```

`src/pro` não ganha ramo de serviço. `src/service` não importa ferramenta de catálogo, carrinho ou estoque, e não chama `admin.from`.

Uma empresa tem um produto. Delivery e Office não dividem login, CNPJ nem cobrança. Quem já paga Delivery e quer o Office cria outra conta e paga o Office. A empresa de serviço da Zampell que já existia permanece. Decisão do dono em 2026-11-26, no lugar da segunda empresa grátis de 2026-11-25.

### D2 — Contexto e oferta, separados do cardápio

`service_profiles` — uma linha por empresa em modo serviço.

| Coluna | Papel |
|---|---|
| `company_id` | PK e FK → `companies` |
| `context_text` | O que a empresa faz, o que não faz, como atender. Teto de 4.000 caracteres, validado na RPC. No prompt entra como dado, entre delimitadores |
| `whatsapp_cancel_enabled` | `boolean not null default false`. Ligado: o cliente cancela horário pelo WhatsApp. Exige `agenda_enabled` |
| `whatsapp_reschedule_enabled` | `boolean not null default false`. Ligado: o cliente remarca horário pelo WhatsApp. Exige `agenda_enabled` |
| `service_preset` | `horario`, `servico`, `consulta_caso` ou `balcao`. O painel de atendimento grava. O checkout de delivery não pergunta |
| `agenda_enabled` | Cópia do modelo. O motor lê este flag, não o nome do segmento |
| `cases_enabled` | Cópia do modelo. Card do serviço ligado ou não |

Endereço, telefone e turnos continuam em `companies` e `company_settings`.

`service_offerings`

| Coluna | Papel |
|---|---|
| `company_id` | FK, indexada |
| `name` | Nome curto |
| `description` | Texto opcional. Fica na tela. Não entra inteiro em todo turno |
| `duration_min` | Nulo = só informação (balcão). Preenchido = marca horário. Entre 15 e 240 |
| `price_cents` | Nulo ou `>= 0`. O dono grava pela RPC. O modelo não envia valor |
| `active` | Fora da lista quando falso |
| `link_url` | Opcional. Só `https`. O modelo não escreve a URL |
| `link_label` | `Ver oferta`, `Ver plano` ou `Ver serviço`. Sem link, não há botão |

No máximo 30 ofertas ativas no prompt, cada uma com nome, duração e preço. Oferta sem duração não entra na grade. Preço nulo é “sob consulta”: o modelo não inventa número. Se a oferta tem link, o turno manda um botão `cta_url` com o rótulo escolhido. No máximo três botões por resposta, e nenhum quando a mesma resposta já pede confirmação de horário ou card.

`service_faqs` — pergunta e resposta escritas pela empresa no painel de atendimento.

| Coluna | Papel |
|---|---|
| `company_id` | FK, indexada |
| `question` | Até 200 caracteres |
| `answer` | Até 1.000 caracteres |
| `active` | Só as ativas entram no prompt. Teto de 40 ativas, na RPC |

O bloco vai entre `<company_faq>`, como dado. Se a fala do cliente corresponder a uma pergunta, a resposta é a cadastrada. Se nenhuma servir, o atendente não inventa e oferece uma pessoa. WhatsApp e chat do site leem a mesma lista. Delivery não usa esta tabela.

### D3 — Vaga oferecida, e uma função só que insere

`service_slot_offers` — o horário que o servidor ofereceu. Não bloqueia a agenda.

| Coluna | Papel |
|---|---|
| `id` | Vai no botão do WhatsApp |
| `company_id`, `thread_id`, `offering_id`, `starts_at` | O que foi oferecido |
| `expires_at` | 15 minutos |
| `consumed_at`, `appointment_id` | Preenchidos na confirmação |
| `superseded_at` | Nova proposta encerra a anterior. O índice único não pode usar `now()` |

Índice único parcial: uma oferta aberta por thread (`consumed_at is null`). Propor de novo expira a anterior. Dois clientes podem receber o mesmo horário. O segundo botão perde e recebe as próximas vagas.

`service_appointments`

| Coluna | Papel |
|---|---|
| `company_id`, `offering_id` | Da empresa e da oferta |
| `customer_id`, `thread_id` | Cliente e conversa já existentes |
| `phone_e164`, `customer_name` | No WhatsApp, o telefone é o da thread. No balcão, o dono informa |
| `starts_at`, `ends_at` | `ends_at` calculado: `starts_at + duration_min` |
| `during` | `tstzrange(starts_at, ends_at, '[)')` gerado |
| `status` | `confirmed` ou `cancelled` |
| `offering_name`, `price_cents` | Cópia da oferta no instante da marcação |
| `case_id` | Nulo, ou um card desta empresa e deste telefone, em `aberto` ou `em_andamento` |
| `source` | `whatsapp_button` ou `admin` |
| `idempotency_key` | Id da mensagem do botão, ou a chave do header no balcão |

Não há coluna de anotação. O que foi dito fica na conversa. Unique `(company_id, idempotency_key)`.

Trava nos confirmados:

```sql
exclude using gist (company_id with =, during with &&)
where (status = 'confirmed')
```

Índices de leitura: `(company_id, starts_at)` onde `status = 'confirmed'`, e `(company_id, phone_e164, starts_at)` para o próximo horário da inbox.

`fn_service_insert_appointment` é a única inserção (`SECURITY DEFINER`, `search_path = public, pg_temp`):

1. A empresa está em `service` e `agenda_enabled` é verdadeiro. Oferta, thread, cliente e card, quando vierem, são dessa empresa e deste telefone.
2. A oferta de vaga, no caminho do botão, está aberta, no prazo, e é travada com `FOR UPDATE`.
3. `starts_at` cai num turno de `opening_periods`, no `timezone` da empresa, inclusive quando o turno cruza a meia-noite, e numa grade da duração. Sem turno, recusa.
4. Calcula `ends_at`, copia nome e preço, insere `confirmed`.
5. O mesmo telefone não fica com seis marcações futuras confirmadas nessa empresa. A sexta recusa. É trava contra loop.
6. Conflito de range não grava e devolve as próximas vagas.
7. A mesma `idempotency_key` devolve a linha que já existe.

Chamadores, os dois na mesma função:

- WhatsApp: só com `offer_id` válido. Idempotência = id da mensagem do botão.
- Balcão: rota admin, empresa da sessão, `Idempotency-Key`. O dono informa o telefone.

`list_service_free_slots` devolve os inícios livres. Propor vaga só grava `service_slot_offers` com um desses inícios. A frase “marcado” só sai depois do insert.

Cancelar e remarcar pelo WhatsApp são ferramentas do modelo, cada uma atrás do seu interruptor.

| Interruptor | Ferramenta | Desligado |
|---|---|---|
| `whatsapp_cancel_enabled` | `cancel_appointment` | A ferramenta não entra na lista do turno. A RPC recusa. O agente diz que o cancelamento pelo WhatsApp está fechado e oferece o humano |
| `whatsapp_reschedule_enabled` | `reschedule_appointment` | O mesmo, para remarcar |

A ferramenta só enxerga marcações futuras `confirmed` cujo telefone é o da thread. O id vem dessa lista, não de um uuid solto no texto. A RPC repete a checagem: empresa, telefone da thread, status `confirmed`, interruptor ligado. Desligado no meio da conversa recusa mesmo que a ferramenta tenha sido montada antes.

Remarcar é uma transação: insere o novo horário e cancela o antigo. O início novo tem de ser uma vaga de `list_service_free_slots`. Cancelar antes e marcar depois perde a vaga no meio.

O painel da agenda cancela e remarca com os interruptores desligados. O interruptor vale só para o WhatsApp. O balcão não passa pela ferramenta.

`REVOKE ALL FROM PUBLIC` nas funções. `GRANT EXECUTE` só a `service_role`.

Tabelas novas: `ENABLE` e `FORCE ROW LEVEL SECURITY`, `REVOKE ALL` de `anon` e `authenticated`, uma policy `rls_<tabela>_service_role_only`. O browser não lê a tabela. Sem view nova.

### D4 — O turno

`runServiceTurn`, nesta ordem:

1. Botão de confirmar horário novo: RPC de inserção e texto pronto. Sem modelo e sem débito de IA.
2. Carteira vazia: frase fixa em português e o handover, se a pessoa pedir humano. Sem modelo.
3. Texto livre: no máximo 4 rodadas. Sempre: listar ofertas, pedir humano, responder. Com `agenda_enabled`: listar vagas, propor vaga, listar os horários deste telefone. `cancel_appointment` só com `whatsapp_cancel_enabled`. `reschedule_appointment` só com `whatsapp_reschedule_enabled`. Com `cases_enabled`: listar cards abertos deste telefone e propor card. Não há ferramenta de gravar horário novo, nem de mudar etapa do card.
4. Se o texto diz que marcou, cancelou, remarcou ou abriu card e a RPC deste turno não gravou isso, essa frase sai. Fica o que o servidor fez.

A mensagem do cliente passa pelo mesmo envoltório já usado no PRO. Trace do turno não grava `context_text` nem o corpo da conversa.

Handover chama `applyHandover` em `lib/chatbot/handover.ts`. Os dois motores usam essa função. O serviço não importa o pipeline de delivery.

### D5 — Telas e rotas

| Superfície | Modo serviço |
|---|---|
| Canais / Embedded Signup | Igual |
| Inbox | Lista, bolhas, pausa do bot e ticket. O trilho direito mostra o próximo horário se a agenda existe, e os cards abertos se o card existe. Não chama `/cart` nem `/orders` |
| Templates | Igual. O texto de exemplo deixa de ser “saiu para entrega” |
| Campanhas | Igual, com audiência `all_with_phone`. `ordered_last_days` fica oculto. Opt-in de marketing igual |
| Clientes | Nome e telefone. Limite e saldo a prazo ficam no delivery |
| Configurações | Geral, Canais, Plano, Segurança. Chatbot só no repasse e no crédito de IA |
| Novas | Contexto, Ofertas. Agenda se `agenda_enabled`. Cards se `cases_enabled`. Rótulos das quatro etapas. O dock é Chat e, quando existirem, Agenda e Cards |

O layout do admin, no servidor, recusa Pedidos, fila, PDV, mesas, produtos, promoções, estoque, entregadores e impressão de cozinha quando o modo é serviço. Sumir do menu não basta. A rota admin de serviço devolve 403 para empresa `delivery`, e a RPC também. Toda rota nova entra no inventário de `createAdminClient` com o gate da empresa.

### D6 — Lembrete na outbox que já existe

Fora do primeiro corte de código. O contrato fica fechado para a migration não precisar de outra tabela.

`outbound_jobs.purpose` ganha `appointment_reminder`. O job nasce na marcação, `scheduled_at` na véspera, `dedup_key` `appointment_reminder:<appointment_id>`, `source_id` na marcação. O payload aponta o template `UTILITY` aprovado em `whatsapp_message_templates`. Se houver mais de um, vale o `updated_at` mais recente. O horário do job é a abertura mais cedo do dia anterior, no fuso da empresa. Sem template aprovado, sem thread ou com mais de dois `{{n}}` no corpo, a marcação acontece e o lembrete não é enfileirado. Cancelar a marcação marca o job `skipped` e o envio confere de novo se a marcação ainda está confirmada. Disparo fora da janela de 24 horas só por template. A janela proativa de `opening_periods` continua valendo para o envio: fora dela o job volta para `pending`, não é descartado.

Campanha de marketing não é lembrete. Lembrete não olha `customer_message_consents`.

### D7 — Carteira de IA

O turno com modelo reserva e debita `company_ai_wallets` pelo caminho do ADR 0016, antes da chamada. Botão não debita. Carteira vazia: frase fixa, sem cardápio. Sem segundo preço de token e sem feature key nova.

### D8 — Modelo no cadastro, card do serviço, etapas fixas

A pessoa não é o trabalho. O horário não é o trabalho. O cadastro escolhe um modelo, e o modelo grava dois flags. O motor lê os flags.

| Escolha | `agenda_enabled` | `cases_enabled` | Quem usa |
|---|---|---|---|
| `horario` | sim | não | Clínica, salão, consulta avulsa |
| `servico` | sim | sim | Oficina, serralheria, móveis, reforma |
| `consulta_caso` | sim | sim | Advogado, arquiteto: hora e caso longo |
| `balcao` | não | não | Venda presencial, sem hora e sem card |

`servico` e `consulta_caso` ligam os mesmos flags. A diferença fica no rótulo da tela e no texto de contexto que a empresa escreve. Não há quinta chave de etapa para um deles.

O dono pode trocar o modelo depois, nas configurações. A troca só muda os flags. Card já aberto continua no painel. Com `cases_enabled` falso, o agente não abre card novo. Com `agenda_enabled` falso, não oferece vaga. Cancelar e remarcar exigem agenda ligada e o interruptor daquele ato.

`service_cases` — o card. É o projeto quando o serviço dura. Corte, consulta e troca de óleo não ganham outra tabela: sem card, fica só o horário; com card ligado, até o serviço de um dia é um card que abre e fecha.

| Coluna | Papel |
|---|---|
| `company_id`, `customer_id`, `thread_id`, `phone_e164` | Desta empresa e deste telefone |
| `title` | Nome curto, teto de 80 caracteres |
| `summary` | O que a pessoa pediu, teto de 500 caracteres. Não é ficha |
| `stage` | `aberto`, `em_andamento`, `concluido`, `perdido` |
| `source` | `whatsapp_button` ou `admin` |
| `idempotency_key` | Id da mensagem do botão, ou a chave do header |

Unique `(company_id, idempotency_key)`. Índice `(company_id, phone_e164, stage)`. A quinta combinação `aberto` + `em_andamento` do mesmo telefone recusa. É a mesma trava contra loop da agenda.

Abrir card é botão, como horário novo. A proposta fica em `service_case_offers`, uma aberta por thread, 15 minutos, no mesmo desenho de `service_slot_offers`. A ferramenta `propor card` só existe com `cases_enabled`. Antes, lista os cards `aberto` e `em_andamento` deste telefone. A RPC recusa outro telefone, outra empresa e flag desligado. O agente não muda `stage`. Quem muda é o dono, no painel, por RPC. `concluido` e `perdido` não voltam.

Horário novo não exige card, mesmo com `cases_enabled`. “Quero cortar amanhã” marca e não abre card. “Quero um portão de 4 m” abre card, sem preço e sem hora. A visita cola no card pelo `case_id`, se o card for desta pessoa e ainda estiver `aberto` ou `em_andamento`. Colar a visita não muda a etapa.

`service_case_stage_labels` — uma linha por empresa e por chave, opcional. A chave não muda. O rótulo visível tem teto de 40 caracteres. Sem linha, o rótulo padrão em português vale (`Aberto`, `Em andamento`, `Concluído`, `Perdido`). O agente fala o rótulo. Criar, apagar ou reordenar etapa não existe nesta versão.

### D9 — Chat da vitrine

O mesmo turno atende no site. O canal é `site`. A empresa é a de serviço da Zampell, fixa no servidor. O browser não envia `company_id`.

A página `zampell.com.br` abre um chat. Cada conversa aceita 8 mensagens do visitante. O mesmo IP aceita 30 mensagens por hora. A carteira de IA é a da empresa. Sem saldo, a frase fixa.

O visitante não tem telefone. O canal lista oferta, responde dúvida e manda o botão do link. Não propõe horário, não abre card, não cancela e não remarca. Pedido de humano não abre ticket: a frase aponta o WhatsApp já publicado na vitrine.

A memória do turno é a lista de mensagens do modelo, no WhatsApp e no site. O texto antigo não entra dentro da frase nova. Cada empresa de serviço tem `site_chat_key`. O browser manda essa chave. A página é `https://www.zampell.com.br/chat/{chave}`. A vitrine da Zampell continua na empresa Zampell. Até três respostas rápidas ficam no perfil. Sem chave no corpo, o chat público segue a Zampell.

A empresa de serviço deixa de se chamar Ferrester Serviço e passa a se chamar Zampell. A empresa de delivery Ferrester não muda.

A landpage grava uma visita por navegador no período, sem nome e sem texto. A conversa com a IA é a sessão que já tem pelo menos uma mensagem. Os dois totais ficam em Atendimento, em hoje, 7 dias ou 30 dias. A empresa do número é a da sessão do painel. A visita pública grava só a empresa da vitrine, no servidor.

### D10 — Oferta pública e checkout

Em 2026-11-26 o dono fechou: atendimento é outro produto, com outra tabela. Delivery continua em Essencial, Pro e Market. No mesmo dia, o nome público passou a ser Office. A URL segue `/atendimento` e o painel da empresa continua em `/atendimento`.

No mesmo dia o checkout foi aprovado. O plano `office` tem `product_line = office`. Mensal R$ 159 (`15900`). O ano é desconto fixo de R$ 709,20 (`70920`) sobre 12 × R$ 159, fechando R$ 1.198,80 (`119880`). Não usa o −20% do Delivery. IA inclusa é a coluna gerada, 10% da mensalidade: R$ 15,90, também no anual. 1 assento, sem assento extra. Mais gente é Enterprise, fora do checkout.

A conta nasce com `attendance_mode = service` e preset `balcao`: agenda e card desligados. A empresa troca o modelo no painel. Sem oferta com duração, o agente não marca horário. O checkout é `/signup/office`. A página do Delivery não lista o Office. Upgrade e downgrade continuam na escada Essencial, Pro e Market. Um trigger recusa troca de `product_line` na assinatura. Enterprise segue no WhatsApp, sem preço.

| Oferta | Preço na página | O que a página promete |
| --- | --- | --- |
| Atendimento mensal | R$ 159 | Agente no WhatsApp, agenda e card do serviço |
| Atendimento anual | R$ 99,90 por mês, R$ 1.198,80 à vista | O mesmo. O card usa o desenho do delivery: risca o mensal e mostra o mês do anual |
| Enterprise | sem preço | A empresa chama no WhatsApp e o plano é montado |

O chat do site não entra nessa oferta. O widget da vitrine continua sendo o atendimento da própria Zampell.

Os botões mensal e anual abrem `/signup/office`. Enterprise chama o WhatsApp `556692071285`. A URL pública é `https://www.zampell.com.br/atendimento`. O arquivo da página é `/agente`, porque `/atendimento` no app já é o painel da empresa de serviço. No host da vitrine, `/atendimento` reescreve para `/agente`.

Em 2026-11-27, à noite, o dono tirou o Office da vitrine. `OFFICE_LANDING_VISIBLE` fica falso: o interruptor Delivery/Office some, o rodapé não aponta o Office, e `/atendimento` e `/agente` na vitrine voltam para a home do Delivery. `/signup/office`, o painel e os arquivos da página continuam. O Office passa a ser o atendimento da própria Zampell, para divulgar e vender o Delivery. Religar a vitrine é voltar a constante para verdadeiro.

O agente da empresa Zampell lista uma oferta por plano e por período. Delivery: Essencial, Pro e Market, mensal e anual, nos preços já canônicos do catálogo. Atendimento: mensal R$ 159 e anual R$ 1.198,80 à vista (R$ 99,90 por mês). Enterprise fica sem preço. Nenhuma dessas ofertas tem link. A oferta única antiga “Planos Zampell” fica inativa. O nome da empresa no banco já é Zampell. O contexto do agente proíbe dizer Ferrester.

A lista que o cliente lê é montada no servidor, uma linha por plano, e termina com “Qual desses você tem interesse?”. O modelo não recalcula centavos. Na escolha, a resposta são os benefícios daquela oferta. No chat do site, a frase seguinte pede nome e WhatsApp. Os dois ficam na sessão (`contact_name`, `contact_phone`, `contact_interest`) para a empresa retornar se a pessoa não tocar no botão. O botão “Chamar no WhatsApp” abre o número da loja só com o nome e o plano. O telefone não vai de novo nessa mensagem. No WhatsApp da empresa esse pedido de contato não aparece: o número já é o da conversa.

---

### D11 — Agenda do Google

Em 2026-11-27 o dono pediu a conexão no painel. No mesmo dia, o botão ficou na aba Agenda, no canto superior esquerdo, e a tela passou a ser o mês. Uma empresa de serviço conecta uma conta Google. O cliente final não autoriza nada. Delivery não ganha essa conexão.

O horário marcado continua nascendo em `service_appointments`. A conta Google faz três coisas: a vaga ocupada nessa agenda não é oferecida nem confirmada; o mês da aba Agenda mostra os eventos dessa conta junto com os horários do sistema; o horário confirmado vira um evento, o cancelamento apaga o evento e a remarcação move o mesmo evento. O evento que o sistema gravou não aparece duas vezes. Se a gravação do evento falhar depois que o Postgres já gravou, a marcação fica e o dia mostra “Não entrou no Google”. Sem conta conectada, o turno e o mês seguem só no Postgres.

Escopos: e-mail da conta, livre/ocupado (`calendar.freebusy`) e eventos (`calendar.events`). Não pede a agenda inteira. O refresh token fica cifrado com `CREDENTIALS_ENCRYPTION_KEY` em `service_google_connections`. O browser não recebe o token.

O cliente OAuth é um aplicativo da Web, sem a marca de agente de IA. O retorno registrado no Google é `https://app.zampell.com.br/api/admin/google-calendar/callback`. No servidor, `GOOGLE_CALENDAR_CLIENT_ID` e `GOOGLE_CALENDAR_CLIENT_SECRET` ficam na Vercel e no worker de entrada. Sem essas duas variáveis, o botão fica desligado e a agenda do sistema segue sozinha.

Enquanto o app do Google estiver em teste, só os Gmail listados em Público-alvo autorizam. Cliente de fora dessa lista exige a verificação do Google. Gmail, Meet, login do painel com Google, contatos e Drive ficam de fora. Vários profissionais continuam fora de escopo: é uma conta por empresa.

## Futuro

- Gmail, Google Meet, login do painel com Google e mais de uma agenda por empresa. A marcação continua no Postgres.

---

## Fora de escopo

- Dia da semana fechado, feriado e mais de dois turnos.
- Vários profissionais, salas, fila de espera e encaixe.
- Pagamento, sinal, convênio e nota.
- Ficha, prontuário e coluna de anotação na marcação.
- Plano ou feature key novos.
- Segundo app da Meta, outro webhook, outra fila.
- Reabrir `src/pro` para também atender serviço.
- Guardar vaga pendente em `chatbot_sessions.context`.
- Editor de funil: criar, apagar ou reordenar etapa.
- Etapas diferentes por segmento. Oficina e escritório usam as mesmas quatro chaves.
- Objeto “projeto” além do card. Vários funis, probabilidade, valor obrigatório e ciclo de vida do contato.
- O agente arrastar a etapa do card.

---

## Estrutura de pastas (alvo, quando for implementar)

```text
src/service/
  domain/                         tipos: oferta, vaga, card, etapa
  ports/                          catálogo, vaga, agenda, card, carteira, handover, relógio
  application/
    runServiceTurn.ts
    composeServiceReply.ts
  adapters/supabase/              só RPC
  adapters/handover/              chama lib/chatbot/handover.ts

lib/chatbot/processMessage.ts     único desvio pelo attendance_mode
lib/chatbot/handover.ts           applyHandover, usado pelos dois motores

app/(admin)/agenda/             se agenda_enabled
app/(admin)/cards/              se cases_enabled
app/(admin)/ofertas/
app/(admin)/layout            recusa rota de delivery no modo serviço
components/whatsapp/          trilho de delivery e trilho de serviço
app/api/admin/service-*/      gate de empresa + modo

supabase/migrations/<ts>_service_attendance.sql
tests/service/
docs/ADR/0018-atendimento-servico-agenda.md
```

A grade de horários existe só no Postgres. O TypeScript formata a frase e a lista.

---

## Alternativas rejeitadas

| Alternativa | Por que não |
|---|---|
| Projeto novo na Vercel | Joga fora webhook, dedup, fila, Embedded Signup, inbox, template, campanha e carteira de IA |
| Modo dentro de `companies.settings` jsonb | O desvio do worker precisa de `CHECK` e default |
| Prompt novo dentro de `src/pro` | As ferramentas, o carrinho e os testes são de pedido |
| Vaga pendente em `chatbot_sessions.context` | A sessão expira e o delivery regrava a linha. O botão fica sem horário |
| Ferramenta de gravar horário novo na mão do modelo | Texto “sim” ou texto do contexto da empresa chamaria a inserção. Horário novo continua no botão |
| Cancelar e remarcar sem interruptor | A empresa perde a escolha de fechar esse ato no WhatsApp. Os dois nascem desligados |
| Cancelar pelo id que o modelo escrever | A RPC só aceita marcação futura deste telefone, listada no turno |
| Grade duplicada no TypeScript | Duas fontes do mesmo horário. O turno que fecha `00:00` já é um caso sensível no delivery |
| Esconder o carrinho dentro de `WhatsAppInbox.tsx` | A conversa continuaria buscando `/cart` e `/orders` |
| Só marcar pelo WhatsApp | Quem vende no balcão marca sem conversa. Os dois caminhos usam a mesma função |
| Segurar a vaga com `pending` no `EXCLUDE` | A oferta não bloqueia. Quem confirma primeiro fica com o horário |
| Cancelar e depois marcar, em duas chamadas | No meio, outra pessoa leva a vaga. Remarcar é uma transação |
| Lembrete em tabela própria | `outbound_jobs` já tem agenda, dedup e retentativa |
| `search_path` vazio | Função nova deste repositório usa `public, pg_temp` |
| Handover só com frase | Já quebrou no PRO. O update de `bot_active`, `handover_at` e o ticket são a mesma função |
| Funil editável por segmento | O agente deixa de saber a etapa. As chaves ficam fixas; muda o rótulo |
| Etapas diferentes para clínica e oficina | O que muda é agenda ligada ou não, e card ligado ou não |
| Projeto numa tabela separada do card | O card é o projeto. Serviço de um dia abre e fecha o mesmo card |

---

## Consequências

**Positivas**

- O número, a lista da inbox, o template e a campanha servem aos dois modos.
- O delivery não muda de motor.
- Horário novo o modelo não grava. O botão e o balcão passam pela mesma trava. Cancelar e remarcar pelo WhatsApp o modelo chama, e a RPC só executa com o interruptor ligado e o telefone da thread.
- Oferta, thread e cliente de outra empresa não entram na marcação, mesmo com `service_role`.
- Dois confirmados no mesmo intervalo não gravam.
- Clínica não abre card. Oficina abre card e, se quiser, marca a visita nele. O funil não muda de forma.

**Negativas**

- A inbox separa o trilho. É mais arquivo do que um `if` no carrinho, e é o que impede a chamada de delivery.
- `applyProHandover` muda de pasta. Os call sites do PRO acompanham na mesma entrega.
- Sem turno cadastrado não há horário livre.
- Domingo usa o mesmo turno da semana.
- O lembrete espera template aprovado pela Meta.
- A sexta marcação futura do mesmo telefone recusa. O teto é trava contra loop.
- Com os dois interruptores desligados, o WhatsApp não cancela nem remarca. O cliente ouve que aquele ato está fechado e pode chamar alguém.
- `servico` e `consulta_caso` se comportam igual no banco. A diferença é o texto que a empresa escreve.

---

## Contrato que a implementação não reabre

O checklist curto anterior dizia a ordem e os testes de negócio. Não travava UI, tipo nem rule. Esta seção é a trava. Quem implementar lê isto antes do código e não deriva de novo.

### Rules que valem neste corte

| Rule | O que não pode escapar |
|---|---|
| `ui-expert.mdc` | Dialog, Select, Switch, Tabs e Tooltip saem do Radix que o admin já usa (`components/ui`). `forwardRef` e `asChild` quando houver wrapper. Estado visual com CVA, classes com `cn()`. Token Tailwind e `dark:`. Sem largura mágica (`w-[324px]`). Texto longo com `truncate` ou `line-clamp`. Lista com skeleton. Controle interativo não é `div` sem papel e teclado. Sem `useState` para abrir modal se o Dialog já abre. |
| `arquitetura-lider.mdc` | `src/service` em domínio, ports, application, adapters. UI chama `app/api/admin/service-*`. Sem `admin.from` no turno e no client. `catch` com `unknown`. Fetch externo com `AbortController`. |
| `agente-pro-hexagonal.mdc` | O turno de serviço usa Vercel AI SDK (`generateText`, tools, `stopWhen`). Tool final `respond_to_customer`. Inbound com `wrapUserInboundForLlm`. `AI_RATE_LIMIT` vira `QueueRetryableError`, sem bolha falsa de sucesso. Troca de modelo continua em `modelProvider.ts`. O glob dessa rule hoje é `src/pro` e `lib/chatbot`. Ao criar `src/service`, o glob passa a incluir `src/service/**/*` na mesma entrega. |
| `governanca-seguranca-negocio.mdc` | Preço, fim do horário, etapa e sobreposição só na RPC. O browser não envia valor a gravar. |
| `supabase-migrations-seguranca.mdc` | `ENABLE` + `FORCE` RLS, `REVOKE` de `anon` e `authenticated`, uma policy `service_role_only`, `search_path = public, pg_temp`, `REVOKE` de `PUBLIC` na função, índice em `company_id`. |
| `supabase-migrations.mdc` | Migration aplicada no remoto `zwcfuvohxmvlxhdfbgxo` na mesma entrega, com `SELECT` de policy e grant. Sem stub. |
| `api-createadmin-gate.mdc` | Toda rota nova no inventário `docs/SECURITY_CREATEADMIN_INVENTORY.md`. `company_id` só da sessão. |
| `projeto-pre-producao-radical.mdc` | Sem dual-path. `applyProHandover` muda de pasta e os call sites do PRO vão junto. |
| `decisoes-negocio-antes-codigo.mdc` | Sem plano, preço de plano, feature key ou etapa nova no meio do corte. |

### Contratos tipados

Fonte única em `src/service/domain/types.ts`. União de string, não `string` solta e não `any`.

| Tipo | Valores |
|---|---|
| `AttendanceMode` | `delivery` \| `service` |
| `ServicePreset` | `horario` \| `servico` \| `consulta_caso` \| `balcao` |
| `CaseStage` | `aberto` \| `em_andamento` \| `concluido` \| `perdido` |
| `AppointmentStatus` | `confirmed` \| `cancelled` |
| `AppointmentSource` | `whatsapp_button` \| `admin` |

A borda HTTP valida com Zod o mesmo conjunto. Tool do modelo usa o mesmo tipo no schema. A RPC não devolve `Json` genérico: o adapter mapeia para esses tipos e falha com erro tipado (`slot_taken`, `flag_off`, `cross_tenant`, `cap_reached`, `offer_expired`).

Props de componente estendem o atributo nativo do elemento e, quando houver variante, `VariantProps` do CVA. Exportar o tipo da variante.

### Inconsistências que permanecem de propósito

Não “corrigir” no meio da implementação:

| Parece torto | Fica assim |
|---|---|
| `attendance_mode = service` e preset `servico` | Inglês no modo da empresa, português na escolha do cadastro. São colunas diferentes |
| Etapa `concluido` sem acento, rótulo `Concluído` | A chave é estável. O acento só no rótulo |
| Horário em `confirmed` / `cancelled`, card em português | Não unificar os dois enums |
| `price_cents` inteiro | Não usar `numeric` solto nem real vindo do client |
| Botão `svc_confirm_slot`, `svc_confirm_case` | Não reusar `pro_confirm_order` |
| `chatbot_sessions.cart` | O serviço não escreve nesse campo |
| Grade só no SQL | Não portar `lib/delivery/hours.ts` para dentro de `src/service` |

---

## Checklist de execução

Não começar sem pedido explícito de implementar. Marcar no próprio item. A ordem é a da lista. O item não fecha sem o teste citado.

### 1. Banco

- [x] Migration com `attendance_mode`, `service_profiles`, `service_offerings`, `service_slot_offers`, `service_cases`, `service_case_stage_labels`, `service_appointments.case_id`, funções e `EXCLUDE`. Aplicada em 2026-11-25 (`20261125170000_service_attendance.sql`).
- [x] Backfill das empresas atuais em `delivery` (default da coluna).
- [x] RLS forçado, um policy `service_role_only` por tabela, `anon` e `authenticated` sem grant. Conferido no remoto.
- [x] Função com `search_path = public, pg_temp`, `REVOKE` de `PUBLIC`, `GRANT` só a `service_role`.

### 2. Handover e desvio

- [x] `applyHandover` mora em `lib/chatbot/handover.ts`. Call site do PRO atualizado. Teste do handover continua passando.
- [x] `processInboundMessage` desvia por `attendance_mode`. Empresa `delivery` não entra em `runServiceTurn`.

### 3. Turno

- [x] Botão de horário e botão de card chamam RPC e não chamam o modelo. A proposta de card fica em `service_case_offers` (`20261125183000_service_turn_case_offers.sql`).
- [x] Texto livre: no máximo 4 rodadas, tool final `respond_to_customer`, inbound envolvido, 429 com `QueueRetryableError`.
- [x] Ferramenta só entra se o flag dela está ligado. Flag desligado: a RPC recusa.
- [x] Frase de “marcado”, “cancelado”, “remarcado” ou “card aberto” sem gravação neste turno não sai.
- [x] Carteira reservada antes da chamada, pelo caminho do ADR 0016. Botão não debita.
- [x] Glob de `agente-pro-hexagonal.mdc` inclui `src/service/**/*`.
- [x] Tipos de `src/service/domain/types.ts` usados no schema da tool e no adapter. Sem `any`.

### 4. Telas

- [x] Cadastro: quatro modelos, Select Radix. Configuração permite trocar o modelo depois.
- [x] Interruptor de cancelar e de remarcar: Switch Radix, `disabled` quando a agenda está desligada.
- [x] Contexto, ofertas, agenda, cards e rótulos: Dialog Radix, skeleton, `truncate` / `line-clamp`, `dark:`, sem largura em pixel solto.
- [x] Agenda só com `agenda_enabled`. Cards só com `cases_enabled`. URL de delivery recusada no layout quando o modo é serviço.
- [x] A aba Agenda tem o botão do Google no canto superior esquerdo e o mês mostra a conta junto com os horários do sistema. O token não volta ao browser. Sem as variáveis do cliente, o botão fica desligado.
- [x] Rota nova no inventário de `createAdminClient`. `company_id` da sessão. Zod na borda.
- [x] Trilho da inbox de serviço não chama `/cart` nem `/orders`.

### 5. Lembrete

- [x] `outbound_jobs.purpose` aceita `appointment_reminder`. Job só com template `UTILITY` aprovado. Sem template, a marcação segue e o job não nasce.

### 6. Fechamento

- [x] `npm test` verde, incluindo os casos da seção seguinte. Suíte completa em 2026-11-25: 1943 passaram, 0 falharam. O mock do webhook de delivery passa `attendance_mode`.
- [x] Nenhuma decisão desta ADR reaberta no código (etapa nova, funil editável, preço de plano, ferramenta de gravar horário novo). As etapas continuam `aberto|em_andamento|concluido|perdido`. A ferramenta de horário é `propose_slot`.

---

## Verificação prevista na implementação

- Duas marcações no mesmo intervalo: a segunda volta sem linha nova.
- O mesmo id de mensagem no botão não duplica.
- Oferta expirada ou já consumida não marca.
- `thread_id` ou `customer_id` de outra empresa recusa.
- Telefone diferente do da thread, no caminho do WhatsApp, recusa.
- A sexta marcação futura do mesmo telefone recusa.
- Empresa `delivery` não marca, nem pela rota admin.
- Oferta sem duração não aparece em `list_service_free_slots`.
- Turno que fecha `00:00` gera a mesma grade que os exemplos de `lib/delivery/hours.ts`.
- Botão de confirmar horário novo não chama o modelo.
- Texto do modelo dizendo “marcado”, “cancelado” ou “remarcado”, sem a RPC deste turno ter gravado, não sai para o cliente.
- Interruptor desligado: a ferramenta não está na lista e a RPC recusa.
- Interruptor ligado: a ferramenta cancela ou remarca só marcação futura deste telefone. Id de outra pessoa recusa.
- Agenda do painel cancela com o interruptor do WhatsApp desligado.
- Modelo `horario` não abre card. Modelo `balcao` não oferece vaga. A RPC recusa os dois.
- Card de outro telefone não recebe visita.
- A quinta combinação aberta do mesmo telefone recusa.
- O agente não grava `stage`. O painel grava, e `concluido` / `perdido` não voltam.
- Rótulo trocado aparece na frase. A chave no banco permanece.
- `anon` e `authenticated` sem grant nas tabelas novas.
- Uma policy `service_role_only` em cada tabela nova.
- Trace sem `context_text` e sem corpo da conversa.
