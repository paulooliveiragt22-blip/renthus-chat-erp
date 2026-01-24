// components/AdminOrdersContext.tsx
"use client";

import React, { createContext, useContext } from "react";

type Ctx = {
  openOrder: (orderId: string) => void;
};

export const AdminOrdersContext = createContext<Ctx | null>(null);

export function AdminOrdersProvider({
  openOrder,
  children,
}: {
  openOrder: (orderId: string) => void;
  children: React.ReactNode;
}) {
  return <AdminOrdersContext.Provider value={{ openOrder }}>{children}</AdminOrdersContext.Provider>;
}

export function useAdminOrders() {
  const ctx = useContext(AdminOrdersContext);
  if (!ctx) throw new Error("useAdminOrders must be used inside AdminOrdersProvider");
  return ctx;
}
