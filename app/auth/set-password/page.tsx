import { Suspense } from "react";
import SetPasswordClient from "./SetPasswordClient";

export default function SetPasswordPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-sm">Carregando…</div>}>
            <SetPasswordClient />
        </Suspense>
    );
}
