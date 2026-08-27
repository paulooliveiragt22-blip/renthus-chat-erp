import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "app/superadmin/empresas/[id]/page.tsx");
const dst = path.join(root, "app/platform/empresas/[id]/page.tsx");

const importLine = 'import { platformApi } from "@/lib/platform/clientApi";\n';

let c = fs.readFileSync(src, "utf8");
c = c.replaceAll("/superadmin", "/platform");
c = c.replaceAll('["sa"', '["platform"');
c = c.replace(/import \{[^}]+\} from "@\/lib\/superadmin\/actions";\n/g, importLine);

c = c.replaceAll("getCompany(id)", "platformApi.company(id)");
c = c.replaceAll("getPlans()", "platformApi.plans().then((r) => r.plans)");
c = c.replaceAll(
    "createChannel(companyId, form)",
    "platformApi.createChannel({ company_id: companyId, ...form })"
);
c = c.replaceAll(
    "updateChannelCredentials(channel.id, form)",
    "platformApi.updateChannelCredentials(channel.id, form)"
);
c = c.replaceAll(
    "updateCompany(id, compForm as any)",
    "platformApi.updateCompany(id, compForm as Record<string, unknown>)"
);
c = c.replaceAll(
    "updateSubscription(sub.id, subForm as any)",
    "platformApi.updateSubscription(sub.id, subForm as Record<string, unknown>)"
);
c = c.replaceAll(
    'updateChannelStatus(channelId, status)',
    "platformApi.updateChannel(channelId, { status })"
);

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, c);
console.log("wrote", dst);
