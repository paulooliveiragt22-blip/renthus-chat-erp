

import React, { Suspense } from "react";
import ListaClient from "./ListaClient";

export default function Page() {
    return (
        <Suspense fallback={<main style={{ padding: 24 }}>Carregando...</main>}>
            <ListaClient />
        </Suspense>
    );
}
