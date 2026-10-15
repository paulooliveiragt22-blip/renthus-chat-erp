# NFC-e — contrato de domínio

Fonte de implementação: [`ADR/0014`](./ADR/0014-nfce-sefaz-mt.md).
Passos e arquivos: [`PLANO_NFCE_IMPLEMENTACAO.md`](./PLANO_NFCE_IMPLEMENTACAO.md).

Status do pedido **não é** a nota. A nota é documento à parte, amarrado ao pedido por unique `(company_id, order_id)`. Imposto e número nascem no Postgres. TypeScript assina, transmite e grava protocolo pela RPC. O browser não envia imposto, número, XML nem certificado.

Estado em 2026-10-14: **nada disto está no código.**

---

## 1. Tipos

Arquivo alvo: `src/fiscal/domain/types.ts`. Estes tipos descrevem o que a RPC devolve. Não calculam imposto.

```ts
export const FISCAL_REGIMES = [
  "simples_nacional",
  "simples_excesso",
  "lucro_presumido",
  "lucro_real",
  "mei",
] as const;
export type FiscalRegime = (typeof FISCAL_REGIMES)[number];

/** CRT escrito no XML. Derivado no banco, nunca aceito do client. */
export type Crt = 1 | 2 | 3 | 4;

export const NFCE_STATUSES = [
  "pending_transmission",
  "authorized",
  "rejected",
  "cancel_pending",
  "canceled",
  "denied",
  "number_voided",
] as const;
export type NfceStatus = (typeof NFCE_STATUSES)[number];

export const NFCE_PREPARE_ERRORS = [
  "profile_incomplete",
  "regime_rule_missing",
  "product_fiscal_missing",
  "consumer_document_required",
  "delivery_outside_municipality",
  "interstate_not_nfce",
  "marketplace_intermediary_required",
  "payment_unmapped",
  "order_not_emittable",
  "order_mutated_after_issue",
  "total_mismatch",
] as const;
export type NfcePrepareError = (typeof NFCE_PREPARE_ERRORS)[number];

export type NfcePrepareOk = {
  ok: true;
  documentId: string;
  status: "pending_transmission";
  tpAmb: 1 | 2;
  serie: number;
  numero: number;
  chaveAcesso: string;
  vNf: string;
};

export type NfcePrepareFail = {
  ok: false;
  error: NfcePrepareError;
};

export type NfcePrepareResult = NfcePrepareOk | NfcePrepareFail;
```

`src/fiscal/domain/regime.ts` só expõe o mapa puro CRT, espelho do `CHECK` do banco, para teste de não-divergência:

| Regime | CRT |
|---|---|
| `simples_nacional` | 1 |
| `simples_excesso` | 2 |
| `lucro_presumido` | 3 |
| `lucro_real` | 3 |
| `mei` | 4 |

Se o mapa TypeScript e o `CASE` SQL divergirem, o teste falha. A fórmula do imposto não tem cópia em TypeScript.

---

## 2. Mapa do pedido atual → XML

Fonte do pedido: `orders` + `order_items` + `produto_embalagens` + `siglas_comerciais`. Não criar coluna paralela de quantidade ou preço.

| Pedido | NFC-e | Regra |
|---|---|---|
| `orders.total_amount` | `vNF` | Igualdade exata em `numeric(15,2)` |
| `orders.total` | soma de `vProd` dos itens | Itens, sem frete |
| `orders.delivery_fee` | `vFrete` | Pickup ou fee 0 → `modFrete 9` e `vFrete 0`. Entrega com fee → `modFrete 0` |
| `fulfillment_type = pickup` | `indPres 1` | Sem identificação obrigatória de CPF |
| `fulfillment_type = delivery` | `indPres 4` | Exige documento do consumidor, endereço e mesmo IBGE do estabelecimento |
| `payment_method = cash` | `tPag 01` | `vTroco` = `change_for - vNF` quando `change_for > vNF`; senão 0 |
| `card` | `tPag 03` | `tpIntegra 2` |
| `debit` | `tPag 04` | `tpIntegra 2` |
| `credit_installment` | `tPag 05` | A prazo do PDV |
| `pix` | `tPag 17` | |
| `order_items.qty` | `qCom` | Não multiplicar por `fator_conversao` |
| sigla comercial da embalagem | `uCom` | UN, CX, … |
| `unit_price` | `vUnCom` | Preço de venda já gravado no item |
| `orders.source like 'marketplace%'` | — | `marketplace_intermediary_required` |
| endereço UF ≠ MT | — | `interstate_not_nfce` |
| IBGE do endereço ≠ IBGE do perfil | — | `delivery_outside_municipality` |

`fn_fin_map_payment_method` permanece no financeiro. `fn_nfce_tpag(text)` é função nova, `IMMUTABLE`, e devolve `null` para método desconhecido (`payment_unmapped`).

Fuso de `dhEmi`: `America/Cuiaba`.

---

## 3. Cálculo

`fn_calcular_item_nfce(p_rule_id uuid, p_v_prod numeric, p_v_frete_rateado numeric) returns jsonb`

- `IMMUTABLE`, `search_path = public, pg_temp`.
- Lê `fiscal_tax_rules` daquele id (já escolhida pela vigência no prepare).
- Destaque por dentro: bases e valores saem do `v_prod`. Não incrementam `vNF`.
- IBS/CBS (`gIBSCBS`: CST, `cClassTrib`, base, alíquotas, valores) saem da mesma linha de regra. Para `CRT=3` a ausência de `c_class_trib` na regra faz o prepare devolver `regime_rule_missing`.
- Arredonda cada valor monetário para 2 casas antes de devolver.
- Não contém alíquota literal. A linha de regra é o único lugar do número.

Escolha da regra no prepare: `regime` do perfil + `product_class` do produto + `dhEmi` dentro de `[valid_from, valid_to)`. Zero linhas ou mais de uma → `regime_rule_missing` ou erro de constraint (vigências não se sobrepõem).

Produto sem `product_fiscal_profiles` → `product_fiscal_missing`.

---

## 4. Banco

Todas as tabelas novas:

1. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
2. `REVOKE ALL ON TABLE … FROM anon, authenticated`.
3. Uma policy: `rls_<tabela>_service_role_only` para `ALL` to `public` com `auth.role() = 'service_role'` em `USING` e `WITH CHECK`.
4. Índice em `company_id`.
5. Função nova: `SECURITY DEFINER` só nas RPCs de mutação; funções puras podem ser `INVOKER`. Sempre `search_path = public, pg_temp`. `REVOKE ALL FROM PUBLIC` e de `anon`/`authenticated`. `GRANT EXECUTE` ao `service_role` nas RPCs. A função pura de cálculo pode ser executada pelo `service_role` apenas.

Proibido copiar a policy `marketplace_connections_member_all`.

### `company_fiscal_profiles`

Uma linha por `company_id` (unique).

| Coluna | Constraint |
|---|---|
| `regime` | `fiscal_regime` enum do §1 |
| `cnpj` | `^[0-9]{14}$` |
| `ie` | texto não vazio, só dígitos |
| `uf` | `= 'MT'` neste corte |
| `cmun` | `^[0-9]{7}$` (Sorriso, quando for o caso, é `5107925`; não é default da tabela) |
| `serie` | inteiro 1–999 |
| `tp_amb` | `1` produção ou `2` homologação |
| `cert_secret_name` | nome do segredo no Vault, não o PFX |
| `cert_password_secret_name` | nome do segredo da senha |
| `csc_id` | identificador numérico do CSC (não é secreto) |
| `csc_secret_name` | nome do segredo do token CSC |
| `intermediary_cnpj` | 14 dígitos ou null. Null + pedido marketplace → recusa |

### `fiscal_tax_rules`

| Coluna | Constraint |
|---|---|
| `regime` | enum |
| `product_class` | texto curto (`refeicao`, `bebida_st`, …). Não é NCM |
| `valid_from`, `valid_to` | `valid_to` nulo = aberta. Exclusion/unique impede sobreposição do mesmo `(regime, product_class)` |
| `cfop` | 4 dígitos. Venda interna deste corte: `5102` enquanto a regra disser isso |
| `icms_kind` | `csosn` ou `cst` |
| `icms_code` | texto do código |
| `icms_rate_bps` | inteiro ≥ 0. Basis points (1700 = 17,00%). Pode ser 0 |
| `pis_cst`, `cofins_cst` | texto |
| `pis_rate_bps`, `cofins_rate_bps` | inteiro ≥ 0 |
| `ibs_cbs_cst`, `c_class_trib` | obrigatórios quando `regime` é `lucro_presumido` ou `lucro_real` |
| `ibs_rate_bps`, `cbs_rate_bps` | inteiro ≥ 0 |

A migration de schema **não insere** alíquota. Carga de regra é migration de dado posterior, com o código oficial escrito na própria migration (não inventado na sessão).

### `product_fiscal_profiles`

Uma linha por `product_id` (o produto pai, não a embalagem).

| Coluna | Constraint |
|---|---|
| `ncm` | 8 dígitos |
| `origem` | 0–8 |
| `product_class` | casa com `fiscal_tax_rules.product_class` |
| `cest` | 7 dígitos ou null. Obrigatório se `product_class = 'bebida_st'` |

### `nfce_documents`

| Constraint | Motivo |
|---|---|
| unique `(company_id, order_id)` | um documento por pedido; retry devolve o mesmo |
| unique `(company_id, tp_amb, serie, numero)` | homologação não colide com produção |
| `status` no enum §1 | máquina explícita |
| `v_nf` | `numeric(15,2)` igual ao `total_amount` no prepare |
| `chave_acesso` | 44 dígitos |
| `dh_emi` | `timestamptz` |
| `protocolo` | null até `authorized` / `canceled` |
| `cstat` | texto do retorno SEFAZ, null até a resposta |
| `xml_authorized` | null até confirmar. Não vai para view de painel |

### `nfce_items`

Foto: `document_id`, `n_item`, `product_id`, `produto_embalagem_id`, `q_com`, `u_com`, `v_un_com`, `v_prod`, grupos de imposto em colunas `numeric(15,2)` (não jsonb solto como fonte do total). `SUM(v_prod) + v_frete do documento = v_nf`.

### `nfce_events`

`document_id`, `tipo` (`cancel` | `void_number`), `status`, `protocolo`, `xml_event`. Unique parcial: um cancelamento protocolado por documento.

### `nfce_counters`

`(company_id, tp_amb, serie)` unique, `next_numero integer`. Incremento só dentro de `rpc_prepare_nfce` com `FOR UPDATE`.

### Lock do pedido

Trigger `BEFORE UPDATE OR DELETE` em `order_items` e `BEFORE UPDATE OF total, delivery_fee, payment_method, fulfillment_type, delivery_address` em `orders`: se existir `nfce_documents` daquele pedido com status diferente de `rejected` e `number_voided`, a mutação estoura `order_mutated_after_issue`.

`rpc_set_order_status`:

- destino `delivered` ou `finalized` (o que circular a mercadoria, D6 da ADR) exige documento `authorized` ou flag de contingência já gravada;
- destino `canceled` exige ausência de nota `authorized`, ou evento de cancelamento já protocolado. Pedido já `delivered` não cancela a nota por esta RPC.

`rpc_admin_cancel_order` e `rpc_admin_upsert_order_with_items`: o mesmo lock. Copiar a definição mais nova (caminhos na ADR), não uma migration anterior.

---

## 5. RPCs

Todas recebem `p_company_id uuid` e conferem `orders.company_id = p_company_id`. Retorno `jsonb` no formato §1 (`ok` / `error`). `SECURITY DEFINER`, grants só `service_role`.

| Função | Efeito |
|---|---|
| `fn_nfce_tpag(text)` | `IMMUTABLE`. Código `tPag` ou null |
| `fn_calcular_item_nfce(...)` | `IMMUTABLE`. Snapshot de um item |
| `rpc_prepare_nfce(p_company_id, p_order_id)` | Valida §2, numera, grava documento `pending_transmission` e itens. Idempotente enquanto pending |
| `rpc_confirm_nfce(p_company_id, p_document_id, p_protocolo, p_cstat, p_xml)` | Só de `pending_transmission`. Recusa se `tp_amb` do XML assinado ≠ `tp_amb` do perfil no momento do prepare (gravar `tp_amb` no documento, não reler o perfil) |
| `rpc_reject_nfce(p_company_id, p_document_id, p_cstat, p_motivo)` | `pending_transmission` → `rejected`. O número permanece ocupado até `rpc_void_nfce_number` ou reenvio do mesmo XML |
| `rpc_request_nfce_cancel(p_company_id, p_document_id)` | Só `authorized`, pedido não `delivered`, janela de 24h a partir de `dh_emi`. Grava `cancel_pending` |
| `rpc_confirm_nfce_cancel(...)` | `cancel_pending` → `canceled` com protocolo |
| `rpc_void_nfce_number(...)` | Inutilização. Status `number_voided`. Não reutiliza o número |
| `rpc_get_nfce_xml(p_company_id, p_document_id)` | Devolve o XML autorizado para a rota, depois do check de empresa. Não é view |
| `rpc_upsert_company_fiscal_profile(...)` | Não recebe PFX nem CSC em claro. Recebe os **nomes** dos segredos já criados no Vault por rotina de servidor |
| `rpc_upsert_product_fiscal_profile(...)` | NCM, origem, classe, CEST |

Segredo no Vault é escrito pelo adapter de servidor (`vault.create_secret` via service role), nunca pela rota com o corpo logado.

---

## 6. Views

`security_invoker`. `GRANT SELECT` a `authenticated`. Filtro `company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())`. Sem XML, sem CSC, sem nome de segredo que permita juntar com `vault.decrypted_secrets` a partir do client (o client não tem grant no vault; ainda assim a view não lista `*_secret_name`).

| View | Colunas |
|---|---|
| `v_sec_nfce_documents` | `id`, `company_id`, `order_id`, `tp_amb`, `serie`, `numero`, `status`, `chave_acesso`, `protocolo`, `cstat`, `v_nf`, `dh_emi` |
| `v_sec_company_fiscal_profile` | `company_id`, `regime`, `cnpj`, `ie`, `uf`, `cmun`, `serie`, `tp_amb`, `csc_id`, `has_certificate` (bool), `has_csc` (bool) |
| `v_sec_product_fiscal_profile` | `product_id`, `company_id`, `ncm`, `origem`, `product_class`, `cest` |

---

## 7. Aplicação

```text
src/fiscal/
  domain/types.ts
  domain/regime.ts
  domain/errors.ts
  ports/nfceRepository.port.ts
  ports/certificateVault.port.ts
  ports/sefazDocumentEmitter.port.ts
  application/emitNfce.ts
  application/cancelNfce.ts
  adapters/supabase/nfce.supabase.ts
  adapters/supabase/vaultCertificate.adapter.ts
  adapters/sefaz/emitter.adapter.ts
  index.ts
app/api/fiscal/nfce/emit/route.ts
app/api/fiscal/nfce/cancel/route.ts
app/api/fiscal/profile/route.ts
app/api/fiscal/products/[productId]/route.ts
```

`emitNfce`: `rpc_prepare_nfce` → se `ok`, lê A1 e CSC do Vault para a memória do processo → `SefazDocumentEmitter` serializa, assina e envia **os valores do snapshot** → `rpc_confirm_nfce` ou `rpc_reject_nfce`. Timeout não confirma e não marca rejected: o documento fica `pending_transmission` para retry do mesmo XML.

Não existe builder de XML neste repositório. A biblioteca é a da emenda D9 da ADR. Ela não recalcula imposto. Hosts, se a biblioteca não os embutir: homologação `https://homologacao.sefaz.mt.gov.br/nfcews/services/`, produção `https://nfce.sefaz.mt.gov.br/nfcews/services/`, sufixos `NfeAutorizacao4`, `NfeRetAutorizacao4`, `NfeConsulta4`, `NfeInutilizacao4`, `NfeStatusServico4`, `RecepcaoEvento4`. QR Code versão 3 (NT 2025.001) é responsabilidade da biblioteca.

---

## 8. Prova mínima depois de cada migration

```sql
select pol.polname
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
where c.relname = 'nfce_documents';
-- exatamente rls_nfce_documents_service_role_only

select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'nfce_documents';
-- anon e authenticated ausentes

select grantee
from information_schema.routine_privileges
where routine_name = 'rpc_prepare_nfce';
-- só service_role (e o owner). public/anon/authenticated ausentes
```
