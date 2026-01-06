// app/(admin)/produtos/lista/page.tsx
import React, { Suspense } from "react";
import ListaClient from "./ListaClient";
import dynamic from "next/dynamic";

// CreateProductModal é um cliente (use client). Podemos importar dinamicamente para evitar SSR problems.
const CreateProductModal = dynamic(() => import("./CreateProductModal"), { ssr: false });

export default function Page() {
    return (
        <Suspense fallback={<main style={{ padding: 24 }}>Carregando...</main>}>
            <main style={{ padding: 12 }}>
                {/* botão/modal para cadastrar produto — aparece acima da lista */}
                <CreateProductModal />
                {/* lista */}
                <ListaClient />
            </main>
        </Suspense>
    );
}
