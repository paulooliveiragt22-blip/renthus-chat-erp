import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const files = [
    "page.tsx",
    "empresas/page.tsx",
    "canais/page.tsx",
    "pedidos/page.tsx",
    "seguranca/page.tsx",
    "layout.tsx",
];

const importLine = 'import { platformApi } from "@/lib/platform/clientApi";\n';

for (const f of files) {
    const src = path.join(root, "app/superadmin", f);
    const dst = path.join(root, "app/platform", f);
    let c = fs.readFileSync(src, "utf8");

    c = c.replaceAll("/superadmin", "/platform");
    c = c.replaceAll('["sa"', '["platform"');
    c = c.replaceAll("SuperAdminSidebar", "PlatformSidebar");
    c = c.replaceAll("SuperAdminLayout", "PlatformLayout");
    c = c.replaceAll("SuperadminSegurancaPage", "PlatformSegurancaPage");
    c = c.replaceAll("SuperAdminDashboard", "PlatformDashboard");

    c = c.replace(/import \{[^}]+\} from "@\/lib\/superadmin\/actions";\n/g, importLine);

    c = c.replaceAll("getDashboardStats()", 'platformApi.metrics("dashboard")');
    c = c.replaceAll(
        "getQueueHealthStats(periodMinutes)",
        'platformApi.metrics("queue", periodMinutes)'
    );
    c = c.replaceAll(
        "getProPipelineHealthStats(periodMinutes)",
        'platformApi.metrics("pipeline", periodMinutes)'
    );
    c = c.replaceAll(
        "getCompanies()",
        "platformApi.companies().then((r) => r.companies)"
    );
    c = c.replaceAll("getPlans()", "platformApi.plans().then((r) => r.plans)");
    c = c.replaceAll(
        "createCompany(form)",
        "platformApi.createCompany(form).then((r) => r.id)"
    );
    c = c.replaceAll(
        "getAllChannels()",
        "platformApi.channels().then((r) => r.channels)"
    );
    c = c.replaceAll(
        "updateChannelIdentifier(id, value)",
        "platformApi.updateChannel(id, { from_identifier: value })"
    );
    c = c.replaceAll("getAllOrders(page, LIMIT)", "platformApi.orders(page, LIMIT)");
    c = c.replaceAll("getSecurityOpsStatus()", "platformApi.securityOps()");

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, c);
    console.log("wrote", dst);
}

console.log("done");
