# ADR 0016 — Consumo de IA: corte real da carteira e média por empresa

**Status:** aceito e implementado (2026-10-15). Emenda da crítica aprovada no mesmo dia: reserva antes da chamada, piso do último débito, holds, revoke de DML do `service_role`.
**Data:** 2026-10-15
**Aprovação do dono:** 2026-10-15 (estratégia de corte + RPC; média na UI do lojista, calculada pelos pedidos da própria empresa, a partir do primeiro pedido)
**Escopo técnico:** o turno sem crédito para de conduzir pedido; o saldo da carteira só muda por RPC; a média de tokens/custo por pedido é da empresa e aparece no bloco de crédito IA que o lojista já vê.
**Escopo comercial:** não muda preço de plano, os 10% de crédito incluso (`fn_billing_ai_included_cents`), packs nem a cota `whatsapp_messages`.
**Governança:** `governanca-seguranca-negocio.mdc` (dinheiro e cota no Postgres), `supabase-migrations-seguranca.mdc`, `projeto-pre-producao-radical.mdc` (sem dual-path de débito), `decisoes-negocio-antes-codigo.mdc`

---

## Contexto

O crédito incluso é 10% da mensalidade, gravado em `plans.ai_included_cents` (Essencial R$ 27,90, Pro R$ 34,90, Market R$ 44,90). A carteira da empresa é `company_ai_wallets` (incluso gasto + pack). O perfil da IA (`lib/chatbot/aiCapabilityProfile.ts`) marca `degradado` / `ai_wallet_empty` quando o saldo total é zero. O pipeline só troca o turno por “assistente indisponível” quando `routed.mode === "ai"` e `llmEnabled` é falso (`src/pro/pipeline/runProPipeline.ts`, ramo por volta da linha 1702).

Teste na Ferrester em 2026-10-15, carteira zerada de propósito:

- O perfil gravado em `pipeline_turn_traces` foi `degradado`. Não houve débito novo em `company_ai_ledger`.
- O cliente ainda recebeu “Não trabalhamos com caixa…” e o cardápio de marmita.
- Essas frases são template de `serverResolvePendingPicks` / `orderDraftPresenter`. O bloco do pick aberto (por volta da linha 1294) roda antes do aviso de IA indisponível e não olha a carteira. Com a IA desligada, o classificador que poderia desviar o pick também não roda.

O débito de hoje é leitura e update no TypeScript (`debitAiUsage`), depois da chamada ao modelo. Se o resto é maior que zero e menor que o custo, a função devolve falso, não grava, e o próximo turno ainda vê saldo. Não há `FOR UPDATE` nem CHECK de teto em `company_ai_wallets`. A cota `feature_limits.whatsapp_messages` (8.000 / 20.000 / 40.000) só bloqueia `POST /api/whatsapp/send`. O pipeline não a consulta.

Medição de outubro/2026, pedido simples = WhatsApp, `orders.source = ai_chat_pro_v2`, 1 item, 3 pedidos da Ferrester:

| | Chamadas | Entrada | Saída | Custo |
|---|---|---|---|---|
| Média | 2 | 13.118 | 116 | R$ 0,07 |

Só o turno da busca do produto chama o modelo (ferramenta + resposta). Saudação, entrega, endereço já salvo, resumo, pagamento e confirmação são texto do servidor. Por chamada, nos 84 débitos de `pro_ai_service` em outubro, a mediana foi 7.086 tokens de entrada e 70 de saída (cerca de R$ 0,02); cerca de 5,2 mil da entrada são cache do prompt. Pedido de 2 itens no mesmo mês ficou em 6–8 chamadas e R$ 0,17–0,25.

Esse 13,1 mil é evidência do formato. Não é o número que a loja vê. O ledger não guarda `thread_id` nem `order_id`, então a média por empresa ainda não tem fato atribuído ao pedido.

O medidor atual é `AiCreditUsageMeter` em `app/(admin)/configuracoes/page.tsx`, aba Chatbot, ao lado de “Crédito de IA”. Mostra percentual da carteira, sem valor em reais.

---

## Decisão

Dois fechamentos na mesma entrega, quando a implementação for autorizada. Sem caminho legado de débito no TypeScript.

### D1 — Sem crédito, o turno que chamaria o modelo não continua o pedido

Se `llmEnabled` é falso (`ai_wallet_empty` ou outro motivo de degradação), o pipeline não entra no pick aberto (`serverResolvePendingPicks`). A resposta é `buildAiDegradedOutbound`. Menu, status e atendente continuam.

Botões de checkout de um carrinho já montado (confirmar, pagamento, endereço salvo) não chamam o modelo. Esse caminho não reserva crédito e não é bloqueado por esta regra. O corte é “não iniciar chamada”.

`AI_WALLET_EMPTY` no `AiServiceAdapter` cai no mesmo outbound degradado, com motivo `ai_wallet_empty`.

### D2 — A carteira só muda por RPC, com reserva antes da chamada

Funções, todas `SECURITY DEFINER`, `search_path = public, pg_temp`, `EXECUTE` só para `service_role`:

- `rpc_ensure_ai_wallet` cria a linha, zera o incluso do mês só quando `reserved_cents = 0` e sincroniza o orçamento de `rpc_ai_included_budget`. Não recalcula os 10%.
- `rpc_begin_ai_turn` trava a linha. Disponível = max(0, orçamento − gasto) + prepaid − reservado. Recusa se disponível ≤ 0, ou se `last_debit_cents` > 0 e disponível < último débito. Reserva `greatest(1, hold, último débito)`. Hold repetido aberto devolve `reused` sem somar de novo.
- `rpc_settle_ai_turn` é idempotente em `(company_id, idempotency_key)`. Solta o hold uma vez e cobra `min(custo, 500, disponível)`. Se o custo passa do resto, consome o resto e grava `last_debit_cents` com o valor cobrado. Sem `thread_id` no meta: solta o hold e não cobra.
- `rpc_release_ai_turn` solta o hold se o modelo falhar antes da liquidação.
- `rpc_credit_ai_pack` insere o ledger primeiro (único por `pagarme_order_id`) e só então soma o prepaid.
- `rpc_set_ai_wallet_autorecharge` altera só flags (ligado, pack, último erro).

Holds ficam em `company_ai_holds`, não num kind novo do ledger. Não há CHECK de gasto ≤ orçamento: queda de preço do plano quebraria o trigger de sync.

`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` de `company_ai_wallets` e `company_ai_ledger` saem do `service_role`. `SELECT` permanece. O dono das funções (definer) é quem grava. Tabelas novas: RLS + FORCE, uma policy `*_service_role_only`, `REVOKE ALL` de `anon`, `authenticated` e `service_role`. Sem view autenticada da média.

A primeira chamada de uma empresa (`last_debit_cents = 0`) ainda pode cobrar menos do que gastou, uma vez. A seguinte já exige o último débito observado.

### D3 — Quem chama o modelo reserva antes e liquida depois

`ai.service.ts` (uma reserva por mensagem; cada `onStepFinish` liquida com `turnKey:step:N`), classificador de intent, memória de sessão (`threadId` no fim do construtor), extração estruturada só quando há `threadId`, e STT. O upsert da thread no webhook acontece antes da transcrição, para o hold ter `thread_id`.

Se `begin` recusa, o modelo não é chamado. `finally` chama `rpc_release_ai_turn` (no-op se a liquidação já soltou).

### D4 — Cota de mensagens WhatsApp não é o corte da IA

`feature_limits.whatsapp_messages` e `check_and_increment_usage` continuam no envio manual do admin. Não entram no pipeline.

### D5 — A média é dos pedidos da própria empresa

Unidade: pedido confirmado com `source = ai_chat_pro_v2` daquela `company_id`.

Não entram PDV, cardápio web, flow sem IA nem pedido que não fechou. Conversa sem pedido debita a carteira e não mexe na média.

A partir do primeiro pedido fechado, a média é o consumo daquele pedido. Cada pedido novo recalcula. Não há número global (os 13,1 mil) no lugar da loja que ainda não tem pedido.

A média de pedidos acumula por empresa e não zera com o mês. O crédito incluso é o contrário: não acumula. No vencimento do mês da assinatura (`next_billing_at`; no plano anual, o mesmo dia todo mês) o que sobrou do incluso zera e o mês novo começa com os 10% de novo. Pack comprado não entra nesse reset. A média responde “quanto um pedido dos meus clientes gasta”, não “quanto gastei neste mês”.

### D6 — O fato do pedido fica numa linha, a média é a conta dessa tabela

Tabela `company_ai_order_usage`:

| Coluna | Papel |
|---|---|
| `order_id` | PK, um fato por pedido |
| `company_id` | tenant |
| `thread_id` | conversa de onde saíram os débitos |
| `call_count` | chamadas atribuídas |
| `input_tokens`, `output_tokens` | soma |
| `cache_read_tokens`, `cache_write_tokens` | soma |
| `cost_cents` | soma do que a carteira debitou |
| `created_at` | fechamento |

RLS habilitado e forçado. `REVOKE ALL` de `anon`, `authenticated` e `service_role`. Uma policy `rls_company_ai_order_usage_service_role_only`. Índice em `(company_id, created_at desc)`.

`rpc_attribute_ai_order_usage` é chamada em `order.service.v2` depois de `create_order_with_items`, só para `source = ai_chat_pro_v2`. Não entra na RPC compartilhada (PDV, cardápio, marketplace, mesa). Reclama débitos da thread com `attributed_order_id` nulo e `created_at` posterior ao último uso daquela thread. `order_id` único: retry não soma de novo. O app não manda o total.

`rpc_ai_order_usage_average(p_company_id)` devolve `order_count`, média de chamadas, de entrada, de saída e de `cost_cents`. `count = 0` quando ainda não há pedido. As duas funções seguem o mesmo endurecimento de D2.

### D7 — UI do lojista, no bloco de crédito que já existe

Superfície: `AiCreditUsageMeter` em Configurações → Chatbot (`app/(admin)/configuracoes/page.tsx`), que é a tela do usuário da empresa na operação de delivery. Não vai para o WhatsApp do cliente nem para o cardápio.

O browser continua lendo só `GET /api/admin/ai-wallet`. A rota passa a incluir o retorno de `rpc_ai_order_usage_average`. Sem select de `company_ai_ledger` ou da tabela nova no client.

Com pelo menos um pedido, o bloco mostra:

- média de chamadas por pedido
- média de tokens de entrada e de saída
- custo médio em reais (tradução de `cost_cents`)
- o texto: “Média calculada com os pedidos desta loja, pelo comportamento de compra dos seus clientes. Atualiza a cada pedido novo.”

Sem pedido: “A média aparece depois do primeiro pedido fechado pela IA nesta loja.” Sem cifra emprestada de outra empresa e sem os 13,1 mil como placeholder.

O medidor de percentual da carteira permanece. A média fica ao lado, como leitura do comportamento, não como segundo saldo.

---

## Estrutura (quando for implementar)

| Peça | Onde | Papel |
|---|---|---|
| Reserva | `rpc_begin_ai_turn` + `company_ai_holds` | antes do modelo; piso do último débito |
| Liquidação | `rpc_settle_ai_turn` / `rpc_release_ai_turn` | cobra o resto ou solta o hold |
| Leitura do gate | `rpc_ensure_ai_wallet` + `aiTurnAllowed` | `canUseAi` não grava saldo |
| Perfil | `lib/chatbot/aiCapabilityProfile.ts` | saldo que não cobre o turno → `degradado` |
| Orquestração | `src/pro/pipeline/runProPipeline.ts` | pick aberto exige `llmEnabled` |
| Débito | `ai.service.ts`, intent, STT, session memory, extract com thread | begin / settle / release |
| Fato por pedido | `company_ai_order_usage` + `rpc_attribute_ai_order_usage` | depois de `create_order_with_items`, só `ai_chat_pro_v2` |
| Média | `rpc_ai_order_usage_average` | `GET /api/admin/ai-wallet` |
| UI | `AiCreditUsageMeter` | média da empresa + a frase de D7 |
| Fora | `feature_limits.whatsapp_messages` | cota do envio manual |

O padrão é o do billing já aceito: a regra mora na RPC, o pipeline e a tela só orquestram e exibem.

---

## Emenda — aviso em 10% e recarga no mesmo piso (2026-10-15)

Aprovado pelo dono: avisar o lojista quando o saldo chegar em 10%, e disparar a recarga automática nesse mesmo ponto. Com a recarga automática ligada, o aviso não sai.

O piso é `included_budget_cents / 10` (`fn_ai_low_credit_threshold_cents`): 10% do crédito incluso do mês, que já é 10% do preço do plano. Market = 449 centavos (R$ 4,49). Não é 10% do preço cheio (isso seria o crédito inteiro e a recarga sairia no primeiro débito). O saldo comparado é o total restante (incluso + pack − reserva).

`rpc_note_ai_low_credit` reivindica `low_credit_notice_period_end = included_period_end` uma vez por ciclo, só com `auto_recharge_enabled = false`. O push Web (`fireCompanyAlertPush`) abre `/configuracoes?tab=chatbot`. A fila `ai_recharge_jobs` usa o mesmo piso no lugar dos R$ 0,50. A UI do lojista mostra pedidos restantes (saldo ÷ custo médio), não tokens.

## Fora deste ADR

- Mudar os 10% do plano, o preço dos packs ou ligar de novo a auto-recarga da Ferrester por causa desta média.
- Cortar a IA pela cota de mensagens WhatsApp.
- Mostrar a média ao cliente final.
- Usar a média global de outubro como valor da loja.
