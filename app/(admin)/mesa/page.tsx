"use client";

import MarketPlanGate from "@/components/menu/MarketPlanGate";
import MesaClient from "./MesaClient";

export default function MesaPage() {
    return (
        <MarketPlanGate
            featureKey="table_service"
            title="Atendimento de mesa"
            description="Comandas e salão no plano Market."
        >
            <MesaClient />
        </MarketPlanGate>
    );
}
