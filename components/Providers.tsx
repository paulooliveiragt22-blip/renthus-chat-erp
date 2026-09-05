"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { GlobalOrderNotifier } from "./GlobalOrderNotifier";
import { WorkspaceProvider } from "@/lib/workspace/useWorkspace";
import { usePrefetchPlanFeatures } from "@/lib/billing/usePlanFeatures";
import { createAppQueryClient } from "@/lib/offline/createAppQueryClient";

function PlanFeaturesBootstrap() {
  usePrefetchPlanFeatures();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createAppQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <PlanFeaturesBootstrap />
        <GlobalOrderNotifier />
        {children}
        <Toaster position="top-right" richColors closeButton />
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}
