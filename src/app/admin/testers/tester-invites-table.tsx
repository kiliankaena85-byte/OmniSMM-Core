'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check, Ban, ExternalLink, Calendar, Mail, Clock } from 'lucide-react';
import { revokeTesterInviteAction } from '@/actions/admin/tester-invites';

interface InviteItem {
  id: string;
  code: string;
  status: string;
  expiresAt: string | Date;
  note?: string | null;
  url: string;
  createdAt: string | Date;
  usedEmail?: string | null;
  usedById?: string | null;
  createdBy?: { id: string; email: string } | null;
  usedBy?: { id: string; email: string } | null;
}

interface Props {
  items: InviteItem[];
  tenantId: string;
  onRefresh: () => void;
}

export function TesterInvitesTable({ items, tenantId, onRefresh }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Отозвать эту ссылку-приглашение?')) return;
    setRevokingId(id);
    try {
      await revokeTesterInviteAction(id, tenantId);
      onRefresh();
    } finally {
      setRevokingId(null);
    }
  };

  const renderStatus = (status: string, expiresAt: string | Date) => {
    const isExpired = new Date(expiresAt).getTime() <= Date.now();
    if (status === 'USED') {
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">Использована</span>;
    }
    if (status === 'REVOKED') {
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">Отозвана</span>;
    }
    if (isExpired || status === 'EXPIRED') {
      return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-border">Истекла</span>;
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/20">Активна</span>;
  };

  const getDaysLeft = (expiresAt: string | Date) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Истек';
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return `${days} дн.`;
  };

  if (items.length === 0) {
    return (
      <div className="p-12 text-center bg-card border border-border/60 rounded-2xl">
        <Mail className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <h3 className="text-sm font-bold text-foreground">Нет ссылок-приглашений</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Создайте пакет ссылок, чтобы пригласить тестировщиков в закрытый контур.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card shadow-xs">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="border-b border-border/80 bg-muted/40 text-muted-foreground uppercase tracking-wider text-[10px] font-bold">
            <th className="py-3 px-4">Код / Ссылка</th>
            <th className="py-3 px-4">Статус</th>
            <th className="py-3 px-4">Срок действия</th>
            <th className="py-3 px-4">Тестировщик</th>
            <th className="py-3 px-4">Заметка</th>
            <th className="py-3 px-4 text-right">Действия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50 text-foreground">
          {items.map((inv) => (
            <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
              <td className="py-3 px-4 font-mono">
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[140px] text-muted-foreground">{inv.code.slice(0, 12)}…</span>
                  <button
                    onClick={() => copyUrl(inv.id, inv.url)}
                    title="Скопировать ссылку"
                    className="p-1.5 rounded-lg border border-border/60 hover:bg-muted text-foreground transition-all active:scale-95"
                  >
                    {copiedId === inv.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </td>
              <td className="py-3 px-4">{renderStatus(inv.status, inv.expiresAt)}</td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{new Date(inv.expiresAt).toLocaleDateString('ru-RU')}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted font-bold">
                    {getDaysLeft(inv.expiresAt)}
                  </span>
                </div>
              </td>
              <td className="py-3 px-4">
                {inv.usedEmail ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">{inv.usedEmail}</span>
                    {inv.usedById && (
                      <Link
                        href={`/admin/clients/${inv.usedById}`}
                        className="text-primary hover:underline"
                        title="Открыть профиль"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground italic">— Не использована —</span>
                )}
              </td>
              <td className="py-3 px-4 text-muted-foreground max-w-[180px] truncate">
                {inv.note || '—'}
              </td>
              <td className="py-3 px-4 text-right">
                {inv.status === 'ACTIVE' && new Date(inv.expiresAt).getTime() > Date.now() && (
                  <button
                    onClick={() => handleRevoke(inv.id)}
                    disabled={revokingId === inv.id}
                    title="Отозвать ссылку"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 rounded-lg transition-colors border border-destructive/20 disabled:opacity-50"
                  >
                    <Ban className="w-3 h-3" /> Отозвать
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
