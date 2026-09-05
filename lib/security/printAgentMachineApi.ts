/**
 * Rotas do print agent autenticadas por api_key / código de pareamento.
 * Painel (`/api/agent/keys`, `/api/agent/settings`) fica de fora — exige cookie no proxy.
 */
export function isPrintAgentMachineApi(pathname: string): boolean {
    return (
        pathname === "/api/agent/activate" ||
        pathname.startsWith("/api/agent/activate/") ||
        pathname === "/api/agent/auth" ||
        pathname === "/api/agent/heartbeat" ||
        pathname === "/api/agent/print-data" ||
        pathname === "/api/agent/reprint" ||
        pathname.startsWith("/api/agent/jobs/")
    );
}
