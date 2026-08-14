/** Papéis de equipe no tenant (M3). Domínio puro. */

export const COMPANY_ROLES = ["owner", "admin", "staff"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export function isCompanyRole(v: unknown): v is CompanyRole {
    return typeof v === "string" && (COMPANY_ROLES as readonly string[]).includes(v);
}

export function normalizeCompanyRole(v: unknown): CompanyRole | null {
    const s = String(v ?? "")
        .trim()
        .toLowerCase();
    return isCompanyRole(s) ? s : null;
}

export function roleLabel(role: CompanyRole): string {
    if (role === "owner") return "Proprietário";
    if (role === "admin") return "Administrador";
    return "Operador";
}

/** Quem o ator pode convidar (nunca owner via convite). */
export function inviteableRolesFor(actor: CompanyRole): CompanyRole[] {
    if (actor === "owner") return ["admin", "staff"];
    if (actor === "admin") return ["staff"];
    return [];
}

export function canInviteRole(actor: CompanyRole, target: CompanyRole): boolean {
    return inviteableRolesFor(actor).includes(target);
}

/**
 * Admin não rebaixa/altera owner. Ninguém promove a owner pelo PATCH de equipe.
 * Owner pode alterar admin↔staff. Admin só edita staff.
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
        return nextRole === "admin" || nextRole === "staff";
    }
    if (actorRole === "admin") {
        return targetRole === "staff" && nextRole === "staff";
    }
    return false;
}

/** Desativar: owner pode admin/staff; admin só staff. Nunca o próprio usuário; nunca owner. */
export function canDeactivateMember(params: {
    actorRole: CompanyRole;
    targetRole: CompanyRole;
    isSelf: boolean;
}): boolean {
    const { actorRole, targetRole, isSelf } = params;
    if (isSelf) return false;
    if (targetRole === "owner") return false;
    if (actorRole === "owner") return true;
    if (actorRole === "admin") return targetRole === "staff";
    return false;
}

export function canReactivateMember(params: {
    actorRole: CompanyRole;
    targetRole: CompanyRole;
}): boolean {
    return canDeactivateMember({ ...params, isSelf: false });
}
