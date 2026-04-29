import { FileText } from 'lucide-react';

export const morningConfig = {
    id: 'morning',
    name: 'Morning (חשבונית ירוקה)',
    description: 'חיבור למערכת הנהלת חשבונות להפקת מסמכים וסנכרון לקוחות',
    icon: 'M',
    iconColor: '#22c55e',
    actions: [
        {
            label: 'פתח במורנינג',
            icon: FileText,
            location: 'client_detail',
            condition: (context) => {
                // Check if integration is active and client is linked
                const { client, integrations } = context;
                const morningIntegration = integrations?.find(i => i.provider === 'morning' && i.is_active);
                return morningIntegration && client?.morning_id;
            },
            onClick: ({ client }) => {
                // In a real implementation, this might open a specific URL
                // For now, we'll just open the main Morning app or a placeholder
                window.open('https://app.morning.co.il', '_blank');
            }
        }
    ],
    component: null // Will be loaded dynamically
};

