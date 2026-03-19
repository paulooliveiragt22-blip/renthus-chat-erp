# Cadastro de Produtos — Implementação

Documentação de tudo que foi implementado no formulário de cadastro de produtos (`/produtos/lista`).

---

## 1. Estrutura do formulário

### Nível Produto
- **Nome:** busca ou cria (único por empresa)
- **Categoria:** seleção obrigatória
- **Ativo:** toggle para ativar/desativar no catálogo
- **Acompanhamento:** permite vincular até 2 produtos de acompanhamento (ex.: batata frita + refrigerante)

### Nível Volume
Cada produto pode ter um ou mais volumes (ex.: 350ml, 600ml, 1L):

- **Quantidade:** volume_quantidade (ex.: 350, 600)
- **Unidade:** id_unit_type (ml, L, kg)
- **Estoque atual** e **Estoque mínimo** do volume (distribuídos entre itens)

### Nível Item (por volume)
Cada volume tem itens com sigla comercial (UN, CX, FARD, PAC):

| Campo | Descrição | Obrigatório |
|-------|-----------|-------------|
| **Sigla** | UN, CX, FARD, PAC etc. | Sim |
| **Fator** | Quantidade por unidade (ex.: 12 para CX de 12un) | Sim (> 0) |
| **Preço venda** | Valor de venda | Sim |
| **Preço custo** | Custo do item | Não |
| **Descrição** | Ex.: "CX 15un", "long neck" | Não |
| **Código interno** | Para bipagem | Não |
| **EAN** | Código de barras | Não |
| **Tags** | latinha, gelada, skolzinha… | Não |
| **Estoque** | Quantidade em estoque (na unidade do item) | Não |
| **Estoque mínimo** | Alerta de ruptura | Não |

---

## 2. Validações e regras

### Campo Fator
- **Obrigatório:** deve ser maior que zero em todos os itens
- **Permite apagar:** o usuário pode limpar o campo (fica 0 temporariamente)
- **Ao salvar:** se qualquer item tiver fator 0 ou vazio, exibe: *"Campo Fator é obrigatório e deve ser maior que zero em todos os itens."*
- Não é possível criar ou editar produto sem fator válido

### Estoque compartilhado
- UN e CX do mesmo volume compartilham o mesmo estoque físico
- UN (fator 1): estoque = unidades base
- CX (fator 12): estoque exibido = unidades base ÷ 12
- **Aplicar na UN:** preenche estoque da UN a partir da CX (CX × fator)
- **Aplicar na CX:** preenche estoque da CX a partir da UN (UN ÷ fator)

### Modal de edição
- **Estoque atual e mínimo:** carregados corretamente do `rpc_get_product_full`
- Valores 0 são exibidos (não ficam em branco)
- Distribuição por item: `estoque_item = round(estoque_volume / fator)`

---

## 3. RPCs utilizadas

- **`rpc_create_product_with_items`** — criação com volumes e itens
- **`rpc_update_product_with_items`** — edição em cascata
- **`rpc_get_product_full`** — carregar produto completo para edição (volumes, itens, estoque)
- **`gerar_proximo_codigo_interno`** — gerar código interno para item ou embalagem

---

## 4. Banco de dados

### Tabelas envolvidas
- `products` — produto base
- `product_volumes` — volume (quantidade + unidade), estoque por volume
- `produto_embalagens` — itens (sigla, fator, preço, descrição, etc.)
- `produto_embalagem_acompanhamentos` — vínculo com acompanhamentos

### Migration de backfill (`20260319900001_products_cascade_backfill.sql`)
- Sincroniza em cascata todos os produtos (exceto um `product_id` excluído)
- Garante: product_volumes, product_volume_id em produto_embalagens, unit_type e details em products
- Sincroniza id_unit_type, volume_quantidade, preco_custo, estoque
- Garante fator_conversao ≥ 1

---

## 5. UI/UX

### Efeito hover nos cards
- Cards do formulário e das listas usam: `transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md`
- Mesmo padrão aplicado em Dashboard, Financeiro, PDV, etc.

### Modais
- **Create:** modal amplo com volumes e itens
- **Edit:** carrega dados via `rpc_get_product_full`, permite editar volumes e itens
- **Acompanhamentos:** modal para selecionar até 2 produtos de acompanhamento

---

## 6. Arquivos principais

- `app/(admin)/produtos/lista/ListaClient.tsx` — formulário de cadastro e lista
- `supabase/migrations/20260319600001_acompanhamentos_rpc_create_update.sql` — RPCs create/update
- `supabase/migrations/20260319500001_produto_preco_custo_tags_por_item.sql` — rpc_get_product_full
- `supabase/migrations/20260319900001_products_cascade_backfill.sql` — backfill em cascata

---

*Última atualização: março 2025*
