/**
 * app/(public)/layout.tsx
 *
 * Layout para rotas públicas standalone (sem sidebar, sem header do admin).
 * O AdminShell e o HeaderClient verificam o pathname e se omitem
 * para rotas que começam com /signup.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
