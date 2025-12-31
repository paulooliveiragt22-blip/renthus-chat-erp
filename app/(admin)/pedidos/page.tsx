import React, { Suspense } from "react";
import PedidosClient from "./PedidosClient";

export default function Page() {
    return (
        <Suspense fallback={<main style={{ padding: 24 }}>Carregando...</main>}>
            <PedidosClient />
        </Suspense>
    );
}
