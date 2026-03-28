"use client";

import { useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { playBeep } from "@/lib/utils/playBeep";

/**
 * Componente sem UI — escuta novos pedidos (INSERT em orders) para a empresa
 * e toca um beep sonoro independente da página atual.
 * Deve ser montado uma vez no layout raiz (Providers).
 */
export function GlobalOrderNotifier() {
  const supabase = useMemo(() => createClient(), []);
  const { currentCompanyId: companyId } = useWorkspace();

  useEffect(() => {
    if (!companyId) return;

    const channel = supabase
      .channel(`global-orders-notify-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `company_id=eq.${companyId}`,
        },
        () => { playBeep(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [companyId, supabase]);

  return null;
}
