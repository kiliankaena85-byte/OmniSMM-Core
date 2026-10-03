import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { resolveTenantFromRequest } from '@/lib/tenant-resolver-edge';
import { verifySession } from '@/lib/session';
import { db } from '@/lib/db';
import { TesterInvitesService } from '@/services/security/tester-invites.service';
import { InviteClientCard } from './invite-client-card';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ code: string }>;
};

export default async function InvitePage({ params }: Props) {
  const { code } = await params;
  if (!code) notFound();

  const reqHeaders = await headers();
  const tenantId = resolveTenantFromRequest(reqHeaders);

  const validation = await TesterInvitesService.validateInvite(code, tenantId);
  const session = await verifySession(tenantId);

  let user = null;
  if (session?.userId) {
    user = await db.user.findFirst({
      where: { id: session.userId, tenantId },
      select: { id: true, email: true, isTester: true, role: true },
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background via-background/95 to-muted/30">
      <div className="w-full max-w-md">
        <InviteClientCard
          code={code}
          validation={validation}
          user={user}
        />
      </div>
    </div>
  );
}
