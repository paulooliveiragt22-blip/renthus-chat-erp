# Plano — NFC-e SEFAZ-MT

Status: **não iniciado** (contrato aceito em 2026-10-14).

ADR: [`ADR/0014`](./ADR/0014-nfce-sefaz-mt.md).
Contrato: [`FISCAL_NFCE.md`](./FISCAL_NFCE.md).

Cada passo fecha sozinho: migration aplicada no remoto (MCP `apply_migration` + `execute_sql` de prova), ou `npm test` quando o passo é TypeScript. O passo seguinte não começa com o anterior aberto. Schema **não** semeia alíquota. `tp_amb = 1` não é ligado para restaurante real antes do passo de contingência.

Prefixo das migrations: `20261015` em diante, um arquivo por passo de banco. Nome final no dia do código; o conteúdo abaixo é o que o arquivo tem de conter.

---

## Ordem

| Passo | Entrega | Pode ir a produção de restaurante? |
|---|---|---|
| 0 | Docs (este plano, ADR, contrato) | — |
| 1 | Tipos e mapa CRT no TypeScript, sem banco | não |
| 2 | Tabelas, constraints, RLS, counter | não |
| 3 | Perfil da empresa e do produto (RPC + view) | não |
| 4 | `fn_nfce_tpag` + `fn_calcular_item_nfce` | não |
| 5 | `rpc_prepare_nfce` + lock de pedido | não |
| 6 | XML + assinatura + Vault, sem SEFAZ | não |
| 7 | Adapter SEFAZ-MT homologação + confirm/reject | não (só `tp_amb = 2`) |
| 8 | Cancelamento, inutilização, views de painel, rotas | não |
| 9 | CPF do consumidor + gancho D6 no status | não |
| 10 | Carga da regra fiscal vigente (dado) | só depois do contador entregar a tabela |
| 11 | Contingência offline | gate de `tp_amb = 1` |
| 12 | DANFE / QR Code | acompanha a saída da mercadoria |

---

## Passo 0 — Docs

- [x] 2026-10-14 `docs/ADR/0014-nfce-sefaz-mt.md`
- [x] 2026-10-14 `docs/FISCAL_NFCE.md`
- [x] 2026-10-14 `docs/PLANO_NFCE_IMPLEMENTACAO.md`

---

## Passo 1 — Tipos

Arquivos:

- `src/fiscal/domain/types.ts` — união do contrato §1
- `src/fiscal/domain/regime.ts` — `crtFromRegime`
- `src/fiscal/domain/errors.ts` — guard `isNfcePrepareError`
- `src/fiscal/index.ts` — reexport
- `tests/fiscal/regime.test.ts` — os cinco regimes e o CRT

Sem RPC, sem alíquota, sem cliente Supabase.

- [ ] Arquivos acima
- [ ] `npm test` do arquivo novo

---

## Passo 2 — Fundação no banco

Migration: `supabase/migrations/20261015120000_nfce_foundation.sql`

Objetos:

- enum ou check de `fiscal_regime` e de `nfce_status` (texto + `CHECK`, igual a `orders.status`, sem tipo enum do Postgres se o resto do banco usa texto)
- `company_fiscal_profiles`
- `fiscal_tax_rules` com exclusão de vigência sobreposta
- `product_fiscal_profiles`
- `nfce_documents`
- `nfce_items`
- `nfce_events`
- `nfce_counters`
- RLS `ENABLE` + `FORCE`, `REVOKE ALL` de `anon` e `authenticated`, policy `rls_*_service_role_only` em cada tabela
- índices em `company_id`; unique descritos no contrato

Ainda sem função de cálculo e sem trigger em `orders`.

Prova: SQL do §8 de `FISCAL_NFCE.md` para `nfce_documents`, `company_fiscal_profiles`, `fiscal_tax_rules`.

- [ ] Migration escrita e aplicada no remoto
- [ ] Prova de policy e grants arquivada no comentário do PR (saída do `execute_sql`)

---

## Passo 3 — Cadastro fiscal

Migration: `supabase/migrations/20261015130000_nfce_profiles.sql`

- `rpc_upsert_company_fiscal_profile`
- `rpc_upsert_product_fiscal_profile`
- `v_sec_company_fiscal_profile`
- `v_sec_product_fiscal_profile`

Grants: RPC só `service_role`. Views `SELECT` para `authenticated`, `security_invoker`, filtro `company_users`.

Rotas (neste passo, para o cadastro existir antes da emissão):

- `app/api/fiscal/profile/route.ts` — `requireCompanyAccess`; corpo não contém PFX, senha nem CSC. Só nomes de segredo, regime, IE, IBGE, série, `tp_amb`, `csc_id`
- `app/api/fiscal/products/[productId]/route.ts` — NCM, origem, classe, CEST

Adapter de Vault, ainda sem assinatura:

- `src/fiscal/ports/certificateVault.port.ts`
- `src/fiscal/adapters/supabase/vaultCertificate.adapter.ts` — `vault.create_secret` / leitura pelo nome, chamada só no servidor. Não loga o valor

- [ ] Migration aplicada + prova de grants da RPC e da view
- [ ] Rota recusa corpo com campo `pfx`, `password` ou `cscToken`

---

## Passo 4 — Fórmula

Migration: `supabase/migrations/20261015140000_nfce_calculate.sql`

- `fn_nfce_tpag(text)` `IMMUTABLE`
- `fn_calcular_item_nfce(...)` `IMMUTABLE`

Teste SQL (via `execute_sql` ou teste de integração), com regra **inserida no teste e apagada no fim**, não na migration:

- `pix` → `17`, `cash` → `01`, `card` → `03`, `debit` → `04`, `credit_installment` → `05`, `boleto` → null
- item de R$ 10,00 com regra de teste: `vNF` do item continua 10,00; imposto é coluna de destaque; soma das partes fechadas bate 2 casas
- regra sem `c_class_trib` para regime `lucro_presumido` não é escolhida pelo prepare (coberto de fato no passo 5; aqui a função pode receber a regra e o teste só fixa o arredondamento)

- [ ] Funções aplicadas
- [ ] Casos de `tPag` e arredondamento verificados

---

## Passo 5 — Prepare e lock

Migration: `supabase/migrations/20261015150000_nfce_prepare.sql`

- `rpc_prepare_nfce(uuid, uuid) returns jsonb`
- triggers de lock em `order_items` e `orders` (contrato §4)
- `rpc_admin_upsert_order_with_items`: recriar a partir de `supabase/migrations/20260906190000_idor_rpc_admin_upsert_tenant_checks.sql` e falhar com `order_mutated_after_issue` se já houver nota viva
- não alterar ainda `rpc_set_order_status` (isso é o passo 9, junto do gancho)

Regras do prepare, todas devolvendo o `error` do contrato, sem numerar:

`profile_incomplete`, `regime_rule_missing`, `product_fiscal_missing`, `consumer_document_required`, `delivery_outside_municipality`, `interstate_not_nfce`, `marketplace_intermediary_required`, `payment_unmapped`, `order_not_emittable`, `total_mismatch`.

Sucesso: uma linha em `nfce_documents` + itens, contador incrementado uma vez. Segunda chamada devolve o mesmo `documentId` e o mesmo número.

`orders.source` marketplace recusa. Entrega sem documento recusa. UF ≠ MT recusa. IBGE diferente recusa.

- [ ] Migration aplicada
- [ ] Teste de idempotência (duas chamadas, um número)
- [ ] Teste de lock (upsert de item depois do prepare falha)
- [ ] Teste dos erros listados, cada um sem linha em `nfce_counters` avançando

---

## Passo 6 — Prova da biblioteca (não escrever XML)

A emenda D9 da ADR revoga o builder próprio. Este passo escolhe o `SefazDocumentEmitter` com uma nota de fixture na homologação da SEFAZ-MT. Certificado de teste só em memória. A biblioteca não pode alterar `vNF` nem o imposto do snapshot.

Ordem da prova:

1. `node-sped-nfe` (LGPL-3.0), dentro do processo Node.
2. `@nfewizard/nfce` (GPL-3.0), só se a anterior falhar. Recusar se o uso exigir PFX em disco, log de CSC ou se o schema estiver atrás da NT 2025.002 vigente.
3. Worker PHP com `nfephp-org/sped-nfe` (LGPL-3.0 ou MIT) se as duas falharem. Único motivo para PHP. O worker recebe o snapshot e devolve XML + protocolo. Não acessa o Postgres de pedido.

Arquivos, depois da prova:

- `src/fiscal/ports/sefazDocumentEmitter.port.ts`
- `src/fiscal/adapters/sefaz/emitter.adapter.ts` — o que passou na prova
- `tests/fiscal/emitterSnapshot.test.ts` — o XML gerado preserva `vNF`, `tPag`, `indPres` e o grupo `IBSCBS` do snapshot

- [ ] Prova registrada (biblioteca, versão, `cStat` de homologação, o que foi recusado)
- [ ] Adapter só da biblioteca que passou
- [ ] Teste de snapshot: valor de imposto do XML = valor gravado em `nfce_items`

---

## Passo 7 — Homologação SEFAZ-MT

Migration: `supabase/migrations/20261015160000_nfce_confirm_reject.sql`

- `rpc_confirm_nfce`
- `rpc_reject_nfce`
- confirm recusa `tp_amb` cruzado

Arquivos:

- `src/fiscal/ports/sefazAutorizador.port.ts`
- `src/fiscal/adapters/sefaz/mt/sefazMt.adapter.ts` — hosts do ADR, versão 4.00, `AbortController` 20s
- `src/fiscal/application/emitNfce.ts`
- `src/fiscal/adapters/supabase/nfce.supabase.ts`
- `app/api/fiscal/nfce/emit/route.ts`

Timeout deixa `pending_transmission`. Retry reenvia o mesmo XML e o mesmo número.

- [ ] Confirm/reject aplicados
- [ ] Emissão real em homologação (`tp_amb = 2`) com certificado e CSC do CNPJ do SaaS, até `cStat` de autorizado — evidência fora do git (protocolo anotado no PR, sem XML com dados reais se houver CPF)
- [ ] Rejeição de schema devolve `rejected` e não avança outro número no retry do mesmo pedido

---

## Passo 8 — Eventos, leitura, rotas

Migration: `supabase/migrations/20261015170000_nfce_events_views.sql`

- `rpc_request_nfce_cancel`
- `rpc_confirm_nfce_cancel`
- `rpc_void_nfce_number`
- `rpc_get_nfce_xml`
- `v_sec_nfce_documents`

Arquivos:

- `src/fiscal/application/cancelNfce.ts`
- `app/api/fiscal/nfce/cancel/route.ts`
- `app/api/fiscal/nfce/[id]/xml/route.ts` — chama `rpc_get_nfce_xml` depois do check de empresa

Evento de cancelamento no adapter: `RecepcaoEvento4`. Inutilização: `NfeInutilizacao4`.

- [ ] Janela: cancelamento com pedido `delivered` recusado pela RPC
- [ ] View sem colunas `xml_authorized` e sem `*_secret_name`
- [ ] `npm test` do módulo fiscal

---

## Passo 9 — Documento do consumidor e gancho

O checkout (chat, cardápio, PDV) precisa gravar CPF ou CNPJ do consumidor antes deste passo ligar o bloqueio. Coluna em `customers` (dígitos, check de 11 ou 14) via RPC já existente de cliente, ou o equivalente vigente — ler a RPC de update de cliente mais nova e estendê-la. Não abrir `customers` no browser.

Migration: `supabase/migrations/20261015180000_nfce_status_gate.sql`

Recriar por completo, a partir do arquivo mais novo citado na ADR:

- `rpc_set_order_status` — bloqueio D6
- `rpc_admin_cancel_order` — não cancela pedido com nota `authorized` sem evento protocolado; não cancela nota de pedido `delivered`

Call sites desses RPCs no TypeScript permanecem. O comportamento novo é a recusa jsonb, tratada na fila e no PDV com mensagem em português.

- [ ] CPF/CNPJ no cadastro do consumidor, rota server-side
- [ ] Status `delivered` / `finalized` bloqueado sem nota `authorized`
- [ ] Cancelamento de pedido coberto por teste
- [ ] Fluxo de entrega sem CPF continua vendendo e **não** entra em `delivered` (erro visível para o operador)

---

## Passo 10 — Regra vigente

Migration de **dado**, separada, só quando o contador entregar NCM de uso, `cClassTrib`, CST/CSOSN e alíquotas com vigência. O arquivo cita a fonte (tabela oficial / NT) no comentário. Sem isso, `rpc_prepare_nfce` segue em `regime_rule_missing` — estado correto.

- [ ] Migration de dado aplicada
- [ ] Prepare de um pedido de refeição em homologação autoriza na SEFAZ-MT

---

## Passo 11 — Contingência

Antes de qualquer perfil com `tp_amb = 1`.

- Emissão offline (`tpEmis` de contingência previsto no MOC para NFC-e), XML guardado, transmissão em até 24h
- Job que varre `pending_transmission` parado e ou reenvia o mesmo XML ou chama inutilização
- `rpc_set_order_status` aceita a saída da mercadoria com o flag de contingência gravado no documento

- [ ] Homologação cobre o caminho de contingência (FAQ MT, pergunta 35)
- [ ] Só então um perfil piloto pode ir para `tp_amb = 1`

---

## Passo 12 — DANFE

QR Code com CSC lido na hora da impressão, não persistido na view. Papel térmico 58 mm ou A4, conforme o manual do DANFE NFC-e. Impressão pelo mesmo agente de impressão do PDV (`/api/agent/reprint`), payload novo, sem segundo spool.

- [ ] QR consulta na URL de MT
- [ ] Entrega não marca `delivered` sem DANFE gerado ou contingência (o gate do passo 9 já exige a nota; este passo acrescenta o comprovante)

---

## Fora do plano (não puxar para dentro de um passo)

- NFS-e da taxa de entrega. A taxa já está em `vFrete` na NFC-e.
- NF-e modelo 55.
- Intermediador iFood: a recusa `marketplace_intermediary_required` fica. Coluna `intermediary_cnpj` já nasce no passo 2; preenchê-la e montar `indIntermed` é plano próprio.
- Classe `bebida_st`: coluna `cest` nasce no passo 2. A regra é outra linha do passo 10, quando houver produto.
