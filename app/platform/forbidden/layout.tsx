/** Layout mínimo: sem sidebar do platform admin. */
export default function PlatformForbiddenLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
