import { Suspense } from "react";
import FilaClient from "./FilaClient";

export const metadata = {
  title: "Fila de Confirmação — Renthus",
};

export default function FilaPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">Carregando fila...</div>}>
      <FilaClient />
    </Suspense>
  );
}
