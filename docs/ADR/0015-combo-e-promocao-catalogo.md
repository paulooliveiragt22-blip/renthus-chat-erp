# ADR 0015 — Combo de catálogo e promoção com prazo

**Status:** aceito (2026-10-14) — implementação em curso
**Data:** 2026-10-14
**Emenda:** 2026-10-14 — estoque do combo lê `product_volumes.estoque_atual` (é o que `fn_debitar_estoque_embalagem` debita). `preco_alocado` é a fatia da linha dentro de um combo (`sum(preco_alocado) = combos.preco`). Centavos que não fecham em preço unitário × quantidade viram uma linha extra na venda, com o mesmo componente.
**Aprovação do dono:** 2026-10-14 (estrutura combo × promoção e as nove regras comerciais abaixo)
**Escopo técnico:** o lojista cria combo (kit) e promoção no admin; o cardápio web, o PDV, o chatbot e a mesa vendem o preço que o Postgres calculou; o pedido grava esse preço em `order_items`.
**Escopo comercial:** preço de combo, rateio e preço promocional com início e fim. **Não** altera `produto_embalagens.preco_venda`, cupom, “leve 2 pague 1”, porcentagem avulsa, dia da semana, horário do dia, nem promoção de plano (`plan_promotions`).
**Relacionados:** [`ADR/0014`](./0014-nfce-sefaz-mt.md) (NFC-e lê `order_items.unit_price`), [`FISCAL_NFCE.md`](../FISCAL_NFCE.md), [`CHECKLIST_CARDAPIO_WEB_MARKETPLACE.md`](../CHECKLIST_CARDAPIO_WEB_MARKETPLACE.md)
**Governança:** `governanca-seguranca-negocio.mdc` (preço calculado no Postgres; o app não grava valor enviado pelo browser), `supabase-migrations-seguranca.mdc`, `projeto-pre-producao-radical.mdc` (sem dual-path), `decisoes-negocio-antes-codigo.mdc`

---

## Contexto

O catálogo vendável é `produto_embalagens` (preço em `preco_venda`). Estoque físico baixa pelo trigger de `order_items` (`fn_debitar_estoque_embalagem`, via `fator_conversao`) em `product_volumes.estoque_atual`. O cardápio público lê `rpc_get_public_menu`. O checkout web (`lib/public-menu/checkout/createWebMenuOrder.ts`) copia `preco_venda` e manda `unit_price` para `create_order_with_items`. O PDV, o chatbot (`src/pro/adapters/order/order.service.v2.ts`) e a mesa fazem o mesmo: o cliente do banco informa o preço e a RPC grava.

`plan_promotions` é desconto da assinatura do SaaS. Não serve para preço de produto da loja.

A NFC-e (ADR 0014) usa `order_items.unit_price` como `vUnCom` e exige que a soma dos itens feche com o total do pedido, em `numeric(15,2)`. Um item único “Combo” misturaria NCM e imposto de produtos diferentes.

---

## Decisão

Combo e promoção são agregados separados. O combo existe sem promoção. A promoção, se existir, cobre uma janela e aponta para um combo ou para uma embalagem. `preco_venda` não é reescrito. Não há job que “devolve” o preço quando a promoção acaba.

### D1 — Canais internos usam o mesmo preço efetivo

Cardápio web, PDV, chatbot e mesa chamam a mesma função de preço no momento da venda. iFood e Aiqfome ficam de fora: o preço de marketplace é contrato externo e sync manual.

A mesa entra porque `table_session_items.unit_price` é venda do mesmo catálogo. Deixar a mesa de fora faria a promoção valer no balcão e não na mesa.

### D2 — No pedido, o combo vira uma linha por componente

A venda de N combos grava, para cada componente, quantidade `N × quantidade no combo`, `unit_price` alocado, `combo_id`, `promotion_id` (nulo quando não houver promoção) e `combo_label` (nome do combo no instante da venda).

A baixa de estoque continua no trigger já existente, porque cada linha aponta para `produto_embalagem_id` real. O combo não tem `estoque_atual`.

A NFC-e não ganha coluna de preço. `vUnCom` continua sendo `unit_price`. O total do combo na nota é a soma dessas linhas. `combo_id` e `promotion_id` são rastreio.

Na UI (cardápio, comanda, impressão administrativa) as linhas com o mesmo `combo_id` aparecem agrupadas sob `combo_label`.

### D3 — Pro rata em centavos, resto no maior item

Função `IMMUTABLE` `fn_ratear_preco(p_partes numeric[], p_alvo numeric) returns numeric[]`.

- Entrada e saída em `numeric(15,2)`.
- Cada parte recebe `floor` da sua fatia proporcional.
- Os centavos que faltam para fechar `p_alvo` vão, um a um, para a maior parte. Empate: vence o menor índice do array (a ordem das linhas do combo é a ordem gravada).
- `p_alvo` e cada parte são maiores que zero. A soma das partes é maior que zero. A função não consulta tabela.

O TypeScript não reimplementa essa conta. Teste chama a função no banco.

### D4 — Preço do combo fica congelado

Cada linha do combo guarda `preco_catalogo_snapshot` (o `preco_venda` na hora de precificar) e `preco_alocado` (o valor daquele componente dentro do combo).

Mudança posterior de `preco_venda` não altera o combo. A leitura do admin compara o snapshot com o preço atual e a tela oferece recalcular. Só `rpc_precificar_combo` regrava a alocação.

### D5 — Promoção só reduz

Preço promocional `> 0` e estritamente menor que a base:

- alvo embalagem: base = `preco_venda` no instante de gravar a promoção (snapshot na linha do alvo);
- alvo combo: base = preço do combo já congelado.

`preco_venda` da embalagem permanece o preço de catálogo.

### D6 — Uma promoção por alvo na mesma janela

Janela `[starts_at, ends_at)` em `timestamptz` (fim exclusivo, para duas promoções poderem se encostar na mesma hora).

Conflito no mesmo `(company_id, alvo)` com intervalos que se cruzam é recusado no banco, inclusive se uma delas estiver pausada. Promoção encerrada ocupa só o passado e não bloqueia a seguinte.

Extensão `btree_gist` + `EXCLUDE` em `tstzrange(starts_at, ends_at, '[)')`. Esta extensão ainda não existe no repositório; a migration que cria a tabela a habilita.

### D7 — Produto novo do combo é produto normal

“Produto novo” no assistente chama o cadastro que já existe (`products` + `produto_embalagens`) e a linha do combo aponta para essa embalagem. Pode nascer com `show_on_menu = false` e aparecer só dentro do combo. Não há tipo “produto que só existe no combo”.

### D8 — Estoque do combo é o gargalo dos componentes

Disponível do combo = mínimo, entre as linhas que não vendem com estoque zero, de `floor(product_volumes.estoque_atual / fator_conversao / quantidade_na_linha)`. O volume é o `product_volume_id` da embalagem, ou o primeiro volume do produto — o mesmo fallback de `fn_debitar_estoque_embalagem`. Componente com `vender_com_estoque_zero` não limita o combo. Se todos os componentes permitem estoque zero, o combo não tem teto. O combo não cria flag nova.

### D9 — Vigência é início e fim

Só `starts_at` e `ends_at`. Sem dia da semana e sem hora recorrente (“happy hour”). A UI fala em `America/Cuiaba` (mesmo fuso da NFC-e). A coluna é `timestamptz`.

Status não é digitado:

| Condição | Status |
|---|---|
| `paused` | pausada (não aplica, mesmo dentro da janela) |
| `now() < starts_at` | agendada |
| `starts_at <= now() < ends_at` e não pausada | ativa |
| `now() >= ends_at` | expirada |

---

## Modelo

### Combo

`combos`: `id`, `company_id`, `nome`, `descricao`, `image_path` (opcional, bucket `product-images`), `is_active`, `show_on_menu`, `preco` `numeric(15,2)`, `modo_preco` `pro_rata` | `manual`, timestamps.

`combo_itens`: `combo_id`, `produto_embalagem_id`, `quantidade` inteira `>= 1`, `ordem`, `preco_catalogo_snapshot` (preço unitário de catálogo), `preco_alocado` (fatia da linha dentro de **um** combo, já incluindo a quantidade). Unique `(combo_id, produto_embalagem_id)`. No máximo 20 linhas. A embalagem pertence à mesma `company_id`.

Preço do combo:

- **Pro rata.** O usuário informa `preco`. `0 < preco <= soma(preco_venda × quantidade)`. A RPC grava `preco_alocado` com `fn_ratear_preco`. Igual à soma é kit sem desconto.
- **Manual.** O usuário informa `preco_alocado` de cada linha (`> 0`). `preco` do combo é a soma, calculada na RPC. O body não traz o total.

`sum(preco_alocado) = combos.preco` é trigger adiado nas duas modalidades. Na venda, a fatia × N combos é repartida nas unidades do componente; o centavo que sobra vira outra linha do mesmo `produto_embalagem_id`, para `unit_price × qty` fechar em centavos.

### Promoção

`promocoes`: `id`, `company_id`, `nome`, `starts_at`, `ends_at`, `paused`, timestamps. `ends_at > starts_at`.

`promocao_alvos`: `promocao_id`, exatamente um de `combo_id` ou `produto_embalagem_id`, `preco_promocional`, `preco_base_snapshot`. Unique por alvo dentro da promoção. A checagem de sobreposição da D6 olha o alvo através das linhas, não só o cabeçalho.

Fora desta versão: vários alvos com regras diferentes de empilhamento. Uma promoção pode ter vários alvos, desde que cada alvo respeite a D6 contra qualquer outra promoção.

### Preço efetivo

`fn_preco_efetivo_embalagem(p_embalagem_id, p_em timestamptz) returns numeric`

`fn_preco_efetivo_combo(p_combo_id, p_em timestamptz) returns numeric`

`STABLE`. `p_em` nulo significa `now()`.

- Embalagem com promoção ativa em `p_em`: `preco_promocional` gravado.
- Senão: `preco_venda`.
- Combo com promoção ativa: o preço promocional do combo. O rateio da venda usa os `preco_alocado` congelados como pesos (`fn_ratear_preco`), não o `preco_venda` ao vivo.
- Senão: `combos.preco` e os `preco_alocado` já gravados, sem novo rateio.

Quem grava pedido ignora `unit_price` vindo do cliente. A RPC resolve o preço e estoura o combo (D2). Call sites que hoje mandam preço — `create_order_with_items`, `rpc_admin_upsert_order_with_items`, mesa, checkout web, PDV, `order.service.v2` — passam a mandar `produto_embalagem_id` ou `combo_id` mais quantidade. A definição a alterar é a mais nova no repositório, com `DROP` + `CREATE` da assinatura inteira no mesmo passo:

- `create_order_with_items` em `supabase/migrations/20260819020000_orders_customer_notes.sql`
- `rpc_admin_upsert_order_with_items` em `supabase/migrations/20260906190000_idor_rpc_admin_upsert_tenant_checks.sql`
- leitura pública em `rpc_get_public_menu` (`supabase/migrations/20260805070000_menu_title_no_sigla_fator.sql`), que passa a devolver, por item, preço efetivo, preço de catálogo e `promocao_ends_at`, mais a lista de combos visíveis e a seção de promoções ativas

### RPCs de escrita

Todas `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE` de `PUBLIC`, `GRANT EXECUTE` só para `service_role`.

| RPC | Efeito |
|---|---|
| `rpc_upsert_combo` | Cabeçalho e linhas (embalagens já existentes). Não calcula preço sozinha se o modo exigir preço ainda ausente: combo sem preço não fica `is_active`. |
| `rpc_precificar_combo` | Pro rata ou manual. Única escrita de `preco` e `preco_alocado`. |
| `rpc_upsert_promocao` | Cabeçalho, janela, pausa, alvos e preço promocional. Recusa D5 e D6. |

Leitura do admin: views `v_sec_combos` e `v_sec_promocoes`, `GRANT SELECT` só para `service_role`. A API em `app/api/admin/*` valida a empresa antes de ler. O browser não acessa a tabela.

Tabelas novas: `ENABLE` + `FORCE ROW LEVEL SECURITY`, `REVOKE ALL` de `anon` e `authenticated`, uma policy `rls_<tabela>_service_role_only`. Índice em `company_id` e nas FKs de alvo. `combo_id` / `promocao_id` em `order_items`: `ON DELETE RESTRICT`. Desativar (`is_active = false` / `paused`) é o caminho normal. Apagar combo ou promoção que já esteja numa linha de pedido é recusado pela FK.

### Onde fica no código

| Peça | Lugar |
|---|---|
| Tipos | `src/catalog/domain` |
| Ports | `src/catalog/ports` |
| Casos de uso | `src/catalog/application` |
| Supabase | `src/catalog/adapters` |
| Admin HTTP | `app/api/admin/combos`, `app/api/admin/promocoes` |
| Tela | Produtos no admin (criar combo, criar promoção, anexar combo já existente) |
| Cardápio | `rpc_get_public_menu` + checkout em `lib/public-menu` |

A busca do chatbot inclui combo ativo pelo nome, no mesmo porto de catálogo que já resolve embalagem. Combo ausente dessa busca faz “quero o combo de sexta” cair em produto não encontrado.

### Cardápio

Item em promoção mostra preço de catálogo, preço efetivo e o fim da janela. Combos com `show_on_menu` entram na lista. Há uma seção “Promoções” com o que estiver ativo (embalagem ou combo). Disponibilidade do combo segue a D8 e a flag de estoque zero de cada componente.

---

## Fora deste corte

- Cupom, percentual genérico, leve-N-pague-M, brinde.
- Happy hour e dia da semana.
- Publicar o preço promocional no iFood ou no Aiqfome.
- Reescrever `preco_venda` ou agendar job para restaurar preço.
- Estoque próprio de combo.
- `plan_promotions` e qualquer desconto da assinatura do SaaS.

---

## Consequências

**Positivas**

- A promoção acaba sozinha: a função passa a devolver o preço de catálogo ou o preço do combo.
- Estoque e NFC-e continuam em cima de embalagem real, com soma em centavos exata.
- O browser não escolhe o preço da venda.

**Negativas / custo**

- `create_order_with_items` e `rpc_admin_upsert_order_with_items` mudam de contrato no mesmo passo em que os call sites mudam.
- Combo vendido ocupa faixa de `order_items` (uma por componente), não uma linha só.
- `btree_gist` entra no projeto por causa da D6.

---

## O que não fazer na implementação

- Gravar promoção escrevendo `produto_embalagens.preco_venda`.
- Aceitar `unit_price` do client como preço da venda.
- Duplicar `fn_ratear_preco` em TypeScript.
- Criar produto “só de combo” fora de `products` / `produto_embalagens`.
- Uma linha de pedido “Combo” sem estourar componentes.
- Coluna paralela de preço para a NFC-e. O preço cobrado é `order_items.unit_price`.
- Job que reverte preço no fim da janela.
- Empilhar duas promoções ativas no mesmo alvo.
- Tratar `plan_promotions` como este domínio.
- Copiar uma migration antiga de `create_order_with_items` ou de `rpc_get_public_menu`. A fonte é a citada na seção Preço efetivo.

---

## Checklist de execução

Implementar nesta ordem. Não marcar item sem teste (`npm test` onde houver lógica em TS; a conta de rateio é testada via função no banco).

### Fatia 1 — Schema e preço

- [x] Tabelas, RLS, grants, `btree_gist`, `fn_ratear_preco`, funções de preço efetivo, RPCs de combo e promoção. SQL aplicado no remoto em 2026-10-14 (`db query --linked`). Histórico reparado em 2026-10-14: versões `20261014220000` e `20261014223000` em `supabase_migrations.schema_migrations`.
- [x] Teste de rateio no remoto: `fn_ratear_preco(ARRAY[10,30], 20.01) = {5, 15.01}`; `fn_ratear_preco(ARRAY[10,10], 10.01) = {5.01, 5}`. Recusa de preço acima da soma está em `rpc_precificar_combo` (`combo_preco_acima_do_catalogo`).
- [ ] Teste de janela: sobreposição recusada; fim exclusivo permite a próxima começar no mesmo instante; pausada continua ocupando a janela. A constraint `promocao_alvos_sem_sobreposicao` existe; o INSERT de prova foi bloqueado e ainda não rodou.

### Fatia 2 — Admin

- [x] APIs e tela: combo com produtos existentes ou cadastro novo (produto normal, UN, opcionalmente fora do cardápio); pro rata ou manual; promoção com prazo; anexar combo já criado.
- [x] Aviso quando `preco_venda` divergir do snapshot, com ação de recalcular.

### Fatia 3 — Venda

- [x] `rpc_get_public_menu`, checkout web, PDV, chatbot e mesa resolvem preço na RPC e estouram combo. Marketplace não reprecifica. Mesa congela o preço no lançamento (`order_source = table_service`).
- [x] Cardápio: preço riscado, fim da promoção, seção Promoções, combo visível e estoque-gargalo.
- [x] Busca do chatbot encontra combo pelo nome.
