import { AdminTabbedHeader } from '@/components/admin/tabbed-header';
import { CLIENTS_TABS, ONBOARDING_CONFIGS } from '@/components/admin/navigation-data';
import { enforceSectionAccess } from '@/lib/server/rbac';
import { verifySession } from '@/lib/session';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { resolveAdminTenantContext } from '@/utils/admin-tenant';
import { UserCheck, ShieldCheck } from 'lucide-react';
import { TesterInvitesManager } from './tester-invites-manager';
import { listTesterInvitesAction } from '@/actions/admin/tester-invites';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{
    page?: string;
    status?: string;
    tenant?: string;
  }>;
};

export default async function AdminTestersPage({ searchParams }: Props) {
  await enforceSectionAccess('clients');
  const session = await verifySession();
  const user = session
    ? await db.user.findUnique({
        where: { id: session.userId },
        select: { id: true, role: true, tenantId: true },
      })
    : null;

  const params = await searchParams;
  const cookieStore = await cookies();
  const cookieTenant = cookieStore.get('x_admin_tenant')?.value;
  const activeTenantId = resolveAdminTenantContext(user, params.tenant, cookieTenant);

  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const status = params.status || 'ALL';

  const initialData = await listTesterInvitesAction({
    tenantId: activeTenantId,
    page,
    limit: 50,
    status: status === 'ALL' ? undefined : status,
  });

  return (
    <div className="space-y-6 w-full animate-in fade-in duration-500 ease-out sm:px-2 md:px-0 min-h-full pb-10">
      <AdminTabbedHeader
        icon={UserCheck}
        title="Тестировщики & Ссылки-приглашения"
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground font-medium text-xs">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Закрытый режим тестирования (14 дней на ссылку, 1 email = 1 инвайт)
            </span>
          </div>
        }
        tabs={CLIENTS_TABS}
        onboardingKey="clients"
        onboarding={ONBOARDING_CONFIGS.clients}
      />

      <TesterInvitesManager
        activeTenantId={activeTenantId}
        initialData={initialData.success ? initialData.data : { items: [], total: 0, page: 1, limit: 50, totalPages: 1 }}
      />
    </div>
  );
}
