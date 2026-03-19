# Alinhamento: Produtos, Itens e Estoque

Documento consolidado do que foi proposto e alinhado para implementação.

> **Implementação atual:** ver [PRODUTOS_CADASTRO_IMPLEMENTACAO.md](./PRODUTOS_CADASTRO_IMPLEMENTACAO.md) para o que foi implementado no cadastro.

---

## 1. Estrutura de dados

### Hierarquia
```
products (produto base, ex: "Skol")
    └── product_volumes (cada volume: 300ml, 600ml, 1L)
            └── produto_embalagens (cada item: UN, CX, FARD — combinação volume + sigla)
```

### Tabelas
- **products:** nome (fixo na criação), categoria, preço custo base. Sem estoque consolidado.
- **product_volumes:** volume (300ml, 600ml), unidade (ml/L), **estoque_atual**, **estoque_minimo**, preço custo por volume.
- **produto_embalagens:** liga a product_volume + sigla (UN, CX, FARD). Campos: descrição, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean (EAN).

### Regra de estoque compartilhado
**UN e CX do mesmo volume compartilham o mesmo estoque físico.**

Exemplo:
- Item: Skol 300ml UN (fator = 1)
- Item: Skol 300ml CX 15un (fator = 15)

Estoque é guardado **uma vez por volume** (ex.: 150 unidades base).

- **UN:** exibe 150 unidades.
- **CX:** exibe 150 ÷ 15 = 10 caixas.
- Venda de 1 CX → debita 15 do estoque.
- Venda de 1 UN → debita 1 do estoque.

**Entrada pelo usuário:**
- Se informar estoque na CX: 10 caixas → salva 10 × 15 = **150** no estoque do volume.
- Se informar estoque na UN: 150 unidades → salva **150** no estoque do volume.

O estoque é sempre em **unidades base (UN)**. CX/FARD mostram valor derivado (estoque ÷ fator_conversao).

---

## 2. Onde armazenar o estoque

**Opção A – product_volumes (recomendada)**  
- `product_volumes`: `estoque_atual`, `estoque_minimo`  
- Uma linha de estoque por volume.  
- UN e CX referenciam o mesmo `product_volume`, então compartilham estoque.

**Opção B – produto_embalagens (sem product_volumes)**  
- Estoque só na embalagem UN (fator = 1) de cada “grupo de volume”.  
- CX/FARD do mesmo volume usam estoque derivado.  
- Agrupamento por `(produto_id, volume_quantidade, id_unit_type)`.  
- Mais complexo e mais frágil.

**Recomendação:** implementar `product_volumes` e centralizar estoque nele.

---

## 3. UI – Formulário de cadastro

### Manter (PRINT2 + PRINT3)
- Código interno  
- Categoria  
- Nome do produto (buscar existente ou criar; único por `company_id`)  
- Descrição, Tags, EAN (geral), Volume, Valor unitário, Preço de custo  
- Ativo no catálogo  
- Acompanhamento (Chatbot)

### Remover
- Bloco PRINT4 (“Vende em outra embalagem”)

### Adicionar
- **Botão "ADICIONAR ITEM"**  
  Cada item tem:
  - Sigla (UN, CX, FARD etc.)
  - Descrição
  - Quantidade (fator_conversao)
  - Preço venda
  - Código interno
  - EAN (codigo_barras_ean)
  - **Estoque** (compartilhado com outros itens do mesmo volume)
  - **Estoque mínimo**

Regra na UI: ao preencher Estoque em um item (UN ou CX), o sistema converte e atualiza o estoque do volume. CX: valor × fator; UN: valor direto.

### Terminologia
- Usar **“item”** na interface. Evitar “embalagem”.

---

## 4. Nome do produto

- Campo para `products.name`.
- Combobox: buscar ou criar.
- Regra de unicidade: `UNIQUE(company_id, lower(trim(name)))`.

---

## 5. Arquitetura de acesso

- **SELECT:** apenas via views.
- **INSERT/UPDATE/DELETE:** apenas via RPCs.
- Sem acesso direto às tabelas base.

---

## 6. Views existentes

- `view_chat_produtos` (chat)
- `view_produtos_lista`, `view_pdv_produtos`, etc.

Serão ajustadas quando `product_volumes` for criada.

---

## 7. Ordem sugerida de implementação

1. Migration: criar `product_volumes` e migrar dados.
2. Migration: adicionar `product_volume_id` em `produto_embalagens` e migrar.
3. Migration: constraint de unicidade em `products(company_id, name)`.
4. Migration: mover/remover `products.estoque_atual` e `products.estoque_minimo` conforme nova estrutura.
5. Atualizar trigger de débito de estoque para usar `product_volumes`.
6. Atualizar views e RPCs.
7. Atualizar UI: novo fluxo com “ADICIONAR ITEM” e regra de estoque compartilhado.
8. Atualizar módulo de Estoque para trabalhar por volume.

---

*Documento criado para referência. Nenhuma alteração foi aplicada no código ou no banco.*
