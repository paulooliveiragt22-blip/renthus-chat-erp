// components/print/CupomPdf.tsx
"use client";

import React from "react";
import jsPDF from "jspdf";

type Item = { name: string; qty: number; price: number };

export default function CupomPdf({ storeName = "Minha Loja", items = [], total = 0 }: { storeName?: string; items?: Item[]; total?: number }) {
    const gerarCupomPdf = () => {
        // 58mm largura -> em mm
        const widthMm = 58;
        // estimativa de altura; o jsPDF aceita tamanho dinâmico (altura grande)
        const doc = new jsPDF({ unit: "mm", format: [widthMm, 200] });
        doc.setFont("courier");
        doc.setFontSize(9);
        let y = 4;
        doc.text(storeName, widthMm / 2, y, { align: "center" });
        y += 6;
        doc.text("-----------------------------", 2, y);
        y += 6;
        items.forEach((it) => {
            const line = `${it.name} x${it.qty}  R$ ${it.price.toFixed(2)}`;
            doc.text(line, 2, y);
            y += 5;
        });
        y += 4;
        doc.text(`TOTAL: R$ ${total.toFixed(2)}`, 2, y);
        y += 10;
        doc.text("Obrigado pela preferência!", widthMm / 2, y, { align: "center" });
        doc.save(`cupom_${Date.now()}.pdf`);
    };

    return <button onClick={gerarCupomPdf} style={{ padding: "8px 12px" }}>Exportar Cupom (PDF 58mm)</button>;
}
