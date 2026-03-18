"use client";

import ProdifySidebar from "@/components/ProdifySidebar";

export default function DashboardClient() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      <ProdifySidebar />
      <main className="flex-1 p-6 md:p-8">
        <h2 className="text-2xl font-semibold text-gray-900">
          Dashboard em construção
        </h2>
        <p className="mt-4 text-gray-600 text-sm max-w-xl">
          Esta tela será atualizada com métricas e atalhos de vendas. Por
          enquanto, use o menu lateral para acessar pedidos, WhatsApp e demais
          funcionalidades.
        </p>
      </main>
    </div>
  );
}

