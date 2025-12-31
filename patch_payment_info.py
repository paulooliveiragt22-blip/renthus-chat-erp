#!/usr/bin/env python3
import re
import sys
from pathlib import Path

ROOT = Path(".").resolve()

TARGETS = [
    ROOT / "app" / "(admin)" / "pedidos" / "page.tsx",
    ROOT / "app" / "(admin)" / "layout.tsx",
]

ORDER_PAYMENT_IMPORT = 'import OrderPaymentInfo from "@/components/OrderPaymentInfo";\n'

# ---------- helpers ----------
def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def write(p: Path, s: str):
    p.write_text(s, encoding="utf-8")

def ensure_import(tsx: str, import_line: str) -> str:
    if import_line.strip() in tsx:
        return tsx
    # coloca depois do último import
    m = list(re.finditer(r'^\s*import .*?;\s*$', tsx, flags=re.M))
    if not m:
        return import_line + tsx
    last = m[-1]
    return tsx[: last.end()] + "\n" + import_line + tsx[last.end() :]

def patch_payment_cell_in_pedidos(tsx: str) -> str:
    """
    Troca o bloco de pagamento da tabela por <OrderPaymentInfo ... />
    Baseado no seu padrão atual:
      <div style={{ fontWeight: 800 ... }}>
        {o.payment_method === ...}
        ...
      </div>
      {o.payment_method === "cash" && o.change_for ? (...) : null}
    """
    if "/* PATCH:PAYMENT_CELL */" in tsx:
        return tsx

    pattern = re.compile(
        r"""
        <td\s+style=\{\{\s*padding:\s*8,\s*minWidth:\s*190\s*\}\}>\s*
            <div\s+style=\{\{[^}]*fontWeight:\s*800[^}]*\}\}>\s*
                \{o\.payment_method\s*===\s*"pix"[\s\S]*?\}\s*
            </div>\s*
            \{o\.payment_method\s*===\s*"cash"[\s\S]*?\}\s*
        </td>
        """,
        re.X,
    )

    repl = """
<td style={{ padding: 8, minWidth: 190 }}>
  {/* PATCH:PAYMENT_CELL */}
  <OrderPaymentInfo
    payment_method={o.payment_method}
    paid={!!o.paid}
    total_amount={Number(o.total_amount ?? 0)}
    change_for={o.change_for ?? null}
  />
</td>
"""
    new, n = pattern.subn(repl, tsx, count=1)
    return new if n else tsx

def patch_payment_in_layout_modal(tsx: str) -> str:
    """
    No layout.tsx, procura linha (ou bloco) de pagamento no modal.
    Seu layout atual (que eu te passei) tinha algo como:
      <div><b>Pagamento:</b> ...</div>
    e/ou um bloco textão com payment_method.
    Aqui substituímos por OrderPaymentInfo onde houver "Pagamento:".
    """
    if "/* PATCH:LAYOUT_PAYMENT */" in tsx:
        return tsx

    # padrão: <div><b>Pagamento:</b> ...</div>
    pattern = re.compile(r"<div>\s*<b>Pagamento:</b>[\s\S]*?</div>", re.M)

    repl = """
<div>
  {/* PATCH:LAYOUT_PAYMENT */}
  <b>Pagamento:</b>
  <div style={{ marginTop: 6 }}>
    <OrderPaymentInfo
      payment_method={order.payment_method}
      paid={!!order.paid}
      total_amount={Number(order.total_amount ?? 0)}
      change_for={order.change_for ?? null}
    />
  </div>
</div>
"""
    new, n = pattern.subn(repl, tsx, count=1)
    return new if n else tsx

def patch_cash_preview_in_new_modal(tsx: str) -> str:
    """
    Injeta preview "Levar de troco" logo após input changeFor do modal novo pedido.
    Procura por: value={changeFor} ... onChange setChangeFor(...)
    """
    if "/* PATCH:NEW_CASH_PREVIEW */" in tsx:
        return tsx

    # procura o input do troco no novo pedido
    pattern = re.compile(
        r"""
        (<input[\s\S]*?value=\{changeFor\}[\s\S]*?onChange=\{\(e\)\s*=>\s*setChangeFor\([\s\S]*?\)\}[\s\S]*?/>)
        """,
        re.X,
    )

    preview = r"""\1

    {/* PATCH:NEW_CASH_PREVIEW */}
    <div style={{ marginTop: 8, fontSize: 12 }}>
      <span style={{ color: "#666" }}>Levar de troco:</span>{" "}
      <b>
        R$ {formatBRL(
          Math.max(
            0,
            brlToNumber(changeFor) -
              cartTotalPreview(cart, deliveryFeeEnabled, deliveryFee)
          )
        )}
      </b>
    </div>
"""
    new, n = pattern.subn(preview, tsx, count=1)
    return new if n else tsx

def patch_cash_preview_in_edit_modal(tsx: str) -> str:
    """
    Injeta preview no modal de editar pedido após input editChangeFor.
    """
    if "/* PATCH:EDIT_CASH_PREVIEW */" in tsx:
        return tsx

    pattern = re.compile(
        r"""
        (<input[\s\S]*?value=\{editChangeFor\}[\s\S]*?onChange=\{\(e\)\s*=>\s*setEditChangeFor\([\s\S]*?\)\}[\s\S]*?/>)
        """,
        re.X,
    )

    preview = r"""\1

    {/* PATCH:EDIT_CASH_PREVIEW */}
    <div style={{ marginTop: 8, fontSize: 12 }}>
      <span style={{ color: "#666" }}>Levar de troco:</span>{" "}
      <b>
        R$ {formatBRL(
          Math.max(
            0,
            brlToNumber(editChangeFor) -
              cartTotalPreview(editCart, editDeliveryFeeEnabled, editDeliveryFee)
          )
        )}
      </b>
    </div>
"""
    new, n = pattern.subn(preview, tsx, count=1)
    return new if n else tsx

def patch_print_order(tsx: str) -> str:
    """
    Tenta inserir no HTML do print:
    - Se cartão: "Levar maquininha"
    - Se dinheiro: "Cliente paga com" e "Levar de troco"
    Baseado no seu printOrder anterior que tinha:
      <div><b>Pagamento:</b> ${escapeHtml(full.payment_method)} ${full.paid ? "(pago)" : ""}</div>
    """
    if "/* PATCH:PRINT_PAYMENT */" in tsx:
        return tsx

    pattern = re.compile(
        r"""(<div><b>Pagamento:</b>\s*\$\{escapeHtml\(full\.payment_method\)\}\s*\$\{full\.paid\s*\?\s*"\(pago\)"\s*:\s*""\}\s*</div>)"""
    )

    repl = r"""
<div>
  <!-- PATCH:PRINT_PAYMENT -->
  <b>Pagamento:</b>
  ${escapeHtml(full.payment_method)} ${full.paid ? "(pago)" : ""}
  ${full.payment_method === "card" ? " • Levar maquininha" : ""}
</div>

${full.payment_method === "cash" ? `
  <div><b>Cliente paga com:</b> R$ ${escapeHtml(formatBRL(Number(full.change_for ?? 0)))}</div>
  <div><b>Levar de troco:</b> R$ ${escapeHtml(formatBRL(Math.max(0, Number(full.change_for ?? 0) - Number(full.total_amount ?? 0))))}</div>
` : ``}
"""
    new, n = pattern.subn(repl, tsx, count=1)
    return new if n else tsx

def patch_file(p: Path):
    original = read(p)
    tsx = original

    tsx = ensure_import(tsx, ORDER_PAYMENT_IMPORT)

    if p.name == "page.tsx" and "pedidos" in str(p):
        tsx = patch_payment_cell_in_pedidos(tsx)
        tsx = patch_cash_preview_in_new_modal(tsx)
        tsx = patch_cash_preview_in_edit_modal(tsx)
        tsx = patch_print_order(tsx)

    if p.name == "layout.tsx" and "(admin)" in str(p):
        tsx = patch_payment_in_layout_modal(tsx)

    if tsx != original:
        write(p, tsx)
        print(f"✅ patched: {p}")
    else:
        print(f"⚠️ no changes applied (patterns not found or already patched): {p}")

def main():
    missing = [p for p in TARGETS if not p.exists()]
    if missing:
        print("❌ Arquivos não encontrados:")
        for m in missing:
            print(" -", m)
        print("\nConfere o caminho e rode de novo.")
        sys.exit(1)

    for p in TARGETS:
        patch_file(p)

    print("\n✅ Finalizado. Dicas:")
    print("1) Reinicie o dev server (Ctrl+C e npm run dev)")
    print("2) Se algum patch der 'patterns not found', me mande o trecho do arquivo que eu ajusto o regex.")

if __name__ == "__main__":
    main()
