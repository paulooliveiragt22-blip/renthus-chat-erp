"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

export interface CompanyUser {
  id: string;          // auth.users id
  email: string | null;
  company_id: string;  // workspace atual
}

/**
 * Hook unificado que combina:
 *  - auth.users (id, email) via supabase.auth.getUser()
 *  - workspace atual (company_id) via useWorkspace
 *
 * Substitui o inexistente useAuth() em todos os novos componentes.
 */
export function useCompanyUser() {
  const { currentCompanyId, loading: workspaceLoading } = useWorkspace();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setEmail(data.user?.email ?? null);
      setAuthLoading(false);
    });
  }, []);

  const loading = authLoading || workspaceLoading;

  const user: CompanyUser | null =
    userId && currentCompanyId
      ? { id: userId, email, company_id: currentCompanyId }
      : null;

  return { user, loading };
}
