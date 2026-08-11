"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { GlobalOrderNotifier } from "./GlobalOrderNotifier";
import { WorkspaceProvider } from "@/lib/workspace/useWorkspace";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,       // 30s
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Provider fica no layout raiz (não remonta em navegação client-side) — o fetch de
          workspace/companies roda 1x por sessão e é compartilhado por header, sidebar,
          notifier e todas as páginas admin. */}
      <WorkspaceProvider>
        <GlobalOrderNotifier />
        {children}
        <Toaster position="top-right" richColors closeButton />
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}
