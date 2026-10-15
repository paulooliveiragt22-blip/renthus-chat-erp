# ADR 0014 — NFC-e direta na SEFAZ-MT (Simples, Presumido, Real)

**Status:** aceito (2026-10-14) — documentação fechada; **implementação não iniciada**
**Data:** 2026-10-14
**Emenda:** 2026-10-14 — D9. O passo que mandava escrever XML e assinador em TypeScript está revogado. A linguagem do SaaS não escolhe a biblioteca fiscal.
**Aprovação do dono:** 2026-10-14 (estrutura com os três regimes, depois a crítica de produção; esta ADR registra o contrato criticado)
**Escopo técnico:** emitir NFC-e modelo 65, layout 4.00, no webservice da SEFAZ de Mato Grosso, sem intermediário fiscal, para venda a consumidor final dentro do estado.
**Escopo comercial:** **não** define alíquota, `cClassTrib`, taxa de entrega nova nem preço. A alíquota vigente entra como dado em `fiscal_tax_rules`. O valor cobrado continua sendo `orders.total_amount`.
**Contrato:** [`FISCAL_NFCE.md`](../FISCAL_NFCE.md)
**Execução:** [`PLANO_NFCE_IMPLEMENTACAO.md`](../PLANO_NFCE_IMPLEMENTACAO.md)
**Governança:** `governanca-seguranca-negocio.mdc` (imposto calculado no Postgres), `supabase-migrations-seguranca.mdc`, `projeto-pre-producao-radical.mdc` (sem dual-path), `decisoes-negocio-antes-codigo.mdc`

---

## Contexto

O SaaS vende para restaurante e delivery. O pedido já existe (`orders`, `order_items`, `fulfillment_type`, `delivery_fee`, `payment_method`, `change_for`). Não existe perfil fiscal, NCM, inscrição estadual, certificado nem documento fiscal.

Emissão direta é permitida. A SEFAZ-MT não homologa o software (FAQ NFC-e MT v1.6, 12/03/2015, perguntas 3 e 41). O desenvolvedor usa o ambiente de homologação com certificado ICP-Brasil do próprio CNPJ e CSC de homologação. Produção é por restaurante: credenciamento no CREDESP, IE regular, A1 daquele CNPJ e CSC de produção.

Webservices vigentes (portal SEFAZ-MT, layout 4.00):

| Serviço | Homologação | Produção |
|---|---|---|
| Autorização | `https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4` | `https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4` |
| Retorno | `.../NfeRetAutorizacao4` | `.../NfeRetAutorizacao4` |
| Consulta | `.../NfeConsulta4` | `.../NfeConsulta4` |
| Inutilização | `.../NfeInutilizacao4` | `.../NfeInutilizacao4` |
| Status | `.../NfeStatusServico4` | `.../NfeStatusServico4` |
| Evento | `.../RecepcaoEvento4` | `.../RecepcaoEvento4` |

Os endereços 3.10 do mesmo portal estão fora do emissor.

NT 2025.002-RTC (reforma, IBS/CBS): para `CRT=3` o grupo `IBSCBS` é exigido na homologação desde 01/07/2026. A rejeição de produção UB12-10 está como implementação futura na v1.52; a obrigação de informar não foi suspensa. Simples (`CRT` 1, 2 e 4) entra nessa rejeição depois. O emissor já nasce com o grupo.

---

## Decisão

Um emissor. O regime escolhe a regra vigente. O XML só escreve o snapshot que o banco calculou.

### D1 — Regime é dado, não pasta

| `FiscalRegime` | CRT na nota | Comportamento do prepare |
|---|---|---|
| `simples_nacional` | 1 | Emite se houver regra vigente (CSOSN, em geral 102 para refeição) |
| `simples_excesso` | 2 | Recusa `regime_rule_missing` até existir regra com destaque de ICMS |
| `lucro_presumido` | 3 | Emite com ICMS + PIS/COFINS + grupo `IBSCBS` |
| `lucro_real` | 3 | Igual ao Presumido na NFC-e. Crédito de PIS/COFINS não vai na nota |
| `mei` | 4 | Recusa `regime_rule_missing` até existir regra própria. Não colapsar em Simples |

Presumido e Real compartilham `CRT=3` e diferem na linha de `fiscal_tax_rules` (alíquota de PIS/COFINS e `cClassTrib`). Não há segundo builder de XML.

### D2 — O preço do pedido é o total da nota

`vNF` = `orders.total_amount` (`total + delivery_fee`, trigger `calc_order_total_amount`). O imposto é destaque por dentro. A função de cálculo não soma alíquota em cima de `unit_price`.

Taxa de entrega vai em `vFrete`. `modFrete = 9` quando `fulfillment_type = pickup` ou `delivery_fee = 0`. Entrega com taxa usa `modFrete = 0` (por conta do emitente) e `vFrete = delivery_fee`.

Arredondamento por item em `numeric(15,2)`, depois soma. Cabeçalho diferente da soma dos itens, ou `vNF` diferente de `total_amount`, devolve `total_mismatch` e não numera.

### D3 — Postgres calcula; Node assina e transmite

`fn_calcular_item_nfce` é a única fórmula. `rpc_prepare_nfce` congela o snapshot. O processo Node monta o XML a partir desse snapshot, assina com o A1 lido do Vault e envia à SEFAZ. Não recalcula imposto. Não aceita valor vindo do browser.

### D4 — Certificado e CSC no Vault

`.pfx`, senha do certificado e token CSC ficam em `vault.create_secret`. A tabela de perfil guarda só o nome do segredo. Proibido coluna `bytea` e proibido reutilizar `encryptCredential` (`lib/security/credentialCrypto.ts`): aquela cifra é AES-GCM de string UTF-8 para token de marketplace e devolve `null` se a chave de env falta.

`vault.decrypted_secrets` sem grant para `authenticated`. O CSC não entra em view, log nem URL persistida no painel.

### D5 — O que o prepare recusa, sem chamar a SEFAZ

Códigos em [`FISCAL_NFCE.md`](../FISCAL_NFCE.md). Os que amarram este repositório:

- Entrega (`fulfillment_type = delivery`) sem CPF/CNPJ do consumidor → `consumer_document_required`. O checkout de hoje não coleta CPF; a nota não inventa documento.
- UF do endereço diferente de `MT` → `interstate_not_nfce`.
- Município IBGE do endereço diferente do IBGE do estabelecimento → `delivery_outside_municipality` (FAQ SEFAZ-MT, pergunta 5: delivery de NFC-e dentro do município).
- `orders.source` com prefixo `marketplace` → `marketplace_intermediary_required` enquanto o perfil não tiver CNPJ do intermediador.
- `payment_method` sem mapa `tPag` → `payment_unmapped`. Não usar `fn_fin_map_payment_method` (esse mapa é do razão e junta meios que a NFC-e separa).

`tPag`: `cash` → 01 (e `vTroco` a partir de `change_for`), `card` → 03, `debit` → 04, `credit_installment` → 05, `pix` → 17. Sem NSU de TEF no pedido: `tpIntegra = 2`.

`indPres`: retirada `1`, entrega `4`. `idDest = 1`.

`qCom` é a quantidade da embalagem vendida. `fator_conversao` continua só no trigger de estoque.

`dhEmi` no fuso `America/Cuiaba`.

### D6 — Gancho na circulação da mercadoria

O DANFE acompanha a mercadoria (FAQ MT, pergunta 29). Por isso:

- Entrega: `rpc_set_order_status` para `delivered` falha se não houver NFC-e `authorized` ou contingência registrada para aquele pedido.
- Retirada: o mesmo bloqueio na ida para `finalized`.
- `new` não emite. Item e taxa ainda mudam.
- `delivered` com nota `authorized` não cancela por evento de janela curta. `rpc_admin_cancel_order` e `rpc_set_order_status(..., canceled)` falham se a nota estiver `authorized` sem evento de cancelamento protocolado, e falham sempre que o pedido já estiver `delivered`.

A chamada de `rpc_prepare_nfce` ocorre na ação que antecede essa transição (cozinha libera a saída / balcão fecha a retirada), não num status novo.

### D7 — Numeração por ambiente

Unique `(company_id, tp_amb, serie, numero)`. Contador em `nfce_counters` com lock. Homologação (`tp_amb = 2`) não consome número de produção (`tp_amb = 1`). A chave de 44 dígitos não carrega `tp_amb`; misturar série é colisão.

Segunda chamada de `rpc_prepare_nfce` para o mesmo pedido devolve a mesma nota se o status ainda é `pending_transmission`. XML de homologação (razão social de teste obrigatória) não é confirmado em perfil de produção.

Número preso em pendência ou rejeição que não será reenviado passa por `rpc_void_nfce_number`.

### D8 — Fora deste corte

- NFS-e municipal.
- NF-e modelo 55 (interestadual, B2B).
- Substituição tributária como classe de produto: a coluna `cest` e a classe existem; a regra de bebida só entra quando houver linha vigente. Não é outro emissor.
- Contingência offline é obrigatória **antes** de `tp_amb = 1` para um restaurante real, e é passo próprio do plano. Não bloqueia a homologação online.
- DANFE impresso é passo posterior ao XML autorizado. O QR Code é o da NT 2025.001 (versão 3), gerado pela biblioteca de emissão. O CSC não é gravado em view.

### D9 — Biblioteca de XML, assinatura e SOAP (emenda 2026-10-14)

O SaaS continua TypeScript + SQL. Isso cobre pedido, regra fiscal, numeração e protocolo. Não cobre schema, XMLDSig, QR Code nem o cliente SOAP da SEFAZ.

Escrever `nfceXml.builder` e `xmlSigner` neste repositório está **revogado**. Esse código reproduz mal o que uma biblioteca já acompanha (NT 2025.002 e QR versão 3) e quebra a cada nota técnica.

A porta é `SefazDocumentEmitter`: recebe o snapshot já calculado, o A1 em memória e o CSC em memória; devolve XML assinado e o retorno da SEFAZ. A biblioteca **não recalcula** `vNF` nem imposto. Se a biblioteca reescrever valor, ela não serve.

Evidência em 2026-10-14, antes de escolher o adapter:

| Opção | O que se sabe | O que falta provar |
|---|---|---|
| Código nosso | Não acompanha NT. É a pior opção | — |
| `@nfewizard/nfce` (npm 1.0.5, 2026-08-01, GPL-3.0) | Existe em Node. O pacote irmão declara NT 2025.002 **v.130**, atrás da v1.50/v1.52. Documentação cita teste em SP. O exemplo grava PFX e XML em disco e liga log no console | Homologação MT com o schema vigente, sem arquivo de certificado, sem recalcular imposto |
| `node-sped-nfe` (npm 1.2.52, LGPL-3.0) | Porta Node da família NFePHP | Mesma prova. Sem evidência, neste levantamento, de MT nem da NT v1.52 |
| `nfephp-org/sped-nfe` v5.2.x (LGPL-3.0 ou MIT) | Repositório que publicou ajuste da NT 2025.002 v1.50 (tag v5.2.7) e QR Code versão 3. É PHP | O adapter seria um worker PHP mínimo, certificado só em memória. Não é um segundo SaaS |

O passo 6 do plano é essa prova na homologação da SEFAZ-MT, nesta ordem: `node-sped-nfe`, depois `@nfewizard/nfce`. As duas falhando a prova, o adapter é o worker com `sped-nfe`. PHP entra só nesse caso, porque a biblioteca que está em dia é PHP. Não entra por preferência de linguagem.

---

## Consequências

**Positivas**

- Um layout, três regimes de verdade (`CRT` 1 e 3) e dois regimes que recusam até ter regra (`CRT` 2 e 4).
- Total fiscal igual ao total cobrado e ao que o financeiro já soma (`total + delivery_fee`).
- Vazamento de `service_role` continua grave, mas backup e réplica não levam o PFX em claro.

**Negativas / custo**

- Sem linha em `fiscal_tax_rules`, ninguém emite. A migration de schema não semeia alíquota.
- Pedido de entrega sem CPF não vira nota. O cadastro do consumidor ganha documento num passo do plano, antes do gancho D6.
- Marketplace fica de fora até o CNPJ do intermediador ser coluna do perfil, não um hardcode.

---

## O que não fazer na implementação

- Três pastas ou três builders por regime.
- Constante de alíquota de ICMS, PIS, COFINS, IBS ou CBS no TypeScript ou no corpo da função.
- `encryptCredential` para A1.
- Policy no estilo `marketplace_connections_member_all` nas tabelas fiscais.
- Reutilizar `fn_fin_map_payment_method` como `tPag`.
- Emitir com quantidade convertida por `fator_conversao`.
- Confirmar protocolo de homologação com `tp_amb = 1`.
- Alterar `rpc_set_order_status` ou `rpc_admin_cancel_order` copiando uma migration antiga. A fonte é a definição mais nova no repositório (`rpc_set_order_status` em `supabase/migrations/20260813240000_orders_status_preparing.sql`; `rpc_admin_cancel_order` em `supabase/migrations/20260825030000_order_reverse_operation.sql`; `rpc_admin_upsert_order_with_items` em `supabase/migrations/20260906190000_idor_rpc_admin_upsert_tenant_checks.sql`). `DROP` + `CREATE` da assinatura inteira, no mesmo passo que o lock fiscal.
- Escrever schema, canonicalização XMLDSig, QR Code ou cliente SOAP da NFC-e neste repositório (D9).
- Adotar biblioteca que grave o PFX em disco, logue o CSC ou recalcule `vNF`.
