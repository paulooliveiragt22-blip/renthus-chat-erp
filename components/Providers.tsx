"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlobalAdminAlerts } from "./GlobalAdminAlerts";
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
        <TooltipProvider delayDuration={300}>
          <PlanFeaturesBootstrap />
          <GlobalAdminAlerts />
          {children}
          <Toaster />
        </TooltipProvider>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}
