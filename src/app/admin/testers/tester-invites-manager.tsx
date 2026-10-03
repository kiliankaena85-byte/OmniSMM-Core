'use client';

import { useState } from 'react';
import { GenerateBatchModal } from './generate-batch-modal';
import { TesterInvitesTable } from './tester-invites-table';
import { listTesterInvitesAction } from '@/actions/admin/tester-invites';
import { RefreshCw, Filter } from 'lucide-react';

interface Props {
  activeTenantId: string;
  initialData: {
    items: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const STATUS_FILTERS = [
  { id: 'ALL', label: 'Все' },
  { id: 'ACTIVE', label: 'Активные' },
  { id: 'USED', label: 'Использованные' },
  { id: 'EXPIRED', label: 'Истёкшие' },
  { id: 'REVOKED', label: 'Отозванные' },
];

export function TesterInvitesManager({ activeTenantId, initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState('ALL');
  const [loading, setLoading] = useState(false);

  const fetchInvites = async (filterStatus = status) => {
    setLoading(true);
    try {
      const res = await listTesterInvitesAction({
        tenantId: activeTenantId,
        page: 1,
        limit: 50,
        status: filterStatus === 'ALL' ? undefined : filterStatus,
      });
      if (res.success && res.data) {
        setData(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newStatus: string) => {
    setStatus(newStatus);
    fetchInvites(newStatus);
  };

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card border border-border/70 p-4 rounded-2xl shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => handleFilterChange(f.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                status === f.id
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchInvites()}
            disabled={loading}
            title="Обновить список"
            className="p-2 rounded-xl border border-border/70 bg-card hover:bg-muted text-muted-foreground transition-all active:scale-95"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <GenerateBatchModal tenantId={activeTenantId} onSuccess={() => fetchInvites()} />
        </div>
      </div>

      {/* Invites table */}
      <TesterInvitesTable
        items={data.items}
        tenantId={activeTenantId}
        onRefresh={() => fetchInvites()}
      />
    </div>
  );
}
