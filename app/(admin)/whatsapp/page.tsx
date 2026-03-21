import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";
import { WhatsAppErrorBoundary } from "@/components/whatsapp/ErrorBoundary";

export default function AdminWhatsAppPage() {
    return (
        <WhatsAppErrorBoundary>
            <WhatsAppInbox />
        </WhatsAppErrorBoundary>
    );
}

