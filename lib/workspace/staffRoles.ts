/** Papéis de sistema no tenant. Operadores usam role=member + profile_id (RBAC). */

export const COMPANY_ROLES = ["owner", "admin", "member"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export function isCompanyRole(v: unknown): v is CompanyRole {
    if (typeof v !== "string") return false;
    const s = v.trim().toLowerCase();
    // legado staff → member
    if (s === "staff") return true;
    return (COMPANY_ROLES as readonly string[]).includes(s);
}

export function normalizeCompanyRole(v: unknown): CompanyRole | null {
    const s = String(v ?? "")
        .trim()
        .toLowerCase();
    if (s === "staff") return "member";
    return (COMPANY_ROLES as readonly string[]).includes(s) ? (s as CompanyRole) : null;
}

export function roleLabel(role: CompanyRole): string {
    if (role === "owner") return "Proprietário";
    if (role === "admin") return "Administrador";
    return "Operador";
}

/** Quem o ator pode convidar (nunca owner via convite). */
export function inviteableRolesFor(actor: CompanyRole): CompanyRole[] {
    if (actor === "owner") return ["admin", "member"];
    if (actor === "admin") return ["member"];
    return [];
}

export function canInviteRole(actor: CompanyRole, target: CompanyRole): boolean {
    return inviteableRolesFor(actor).includes(target);
}

/**
 * Admin não rebaixa/altera owner. Ninguém promove a owner pelo PATCH de equipe.
 * Owner pode alterar admin↔member. Admin só edita member (papel fixo member).
 */
export function canChangeMemberRole(params: {
    actorRole: CompanyRole;
    targetRole: CompanyRole;
    nextRole: CompanyRole;
    isSelf: boolean;
}): boolean {
    const { actorRole, targetRole, nextRole, isSelf } = params;
    if (nextRole === "owner") return false;
    if (targetRole === "owner") return false;
    if (isSelf) return false;
    if (actorRole === "owner") {
        return nextRole === "admin" || nextRole === "member";
    }
    if (actorRole === "admin") {
        return targetRole === "member" && nextRole === "member";
    }
    return false;
}

/** Desativar: owner pode admin/member; admin só member. Nunca o próprio; nunca owner. */
export function canDeactivateMember(params: {
    actorRole: CompanyRole;
    targetRole: CompanyRole;
    isSelf: boolean;
}): boolean {
    const { actorRole, targetRole, isSelf } = params;
    if (isSelf) return false;
    if (targetRole === "owner") return false;
    if (actorRole === "owner") return true;
    if (actorRole === "admin") return targetRole === "member";
    return false;
}

export function canReactivateMember(params: {
    actorRole: CompanyRole;
    targetRole: CompanyRole;
}): boolean {
    return canDeactivateMember({ ...params, isSelf: false });
}

/** Remover vínculo da empresa (mesmas regras de desativar). */
export function canRemoveMember(params: {
    actorRole: CompanyRole;
    targetRole: CompanyRole;
    isSelf: boolean;
}): boolean {
    return canDeactivateMember(params);
}

export function canManageTeam(role: CompanyRole): boolean {
    return role === "owner" || role === "admin";
}
