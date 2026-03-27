import React, { Suspense } from "react";
import SuporteClient from "./SuporteClient";

export default function Page() {
    return (
        <Suspense fallback={<main style={{ padding: 24 }}>Carregando...</main>}>
            <SuporteClient />
        </Suspense>
    );
}
