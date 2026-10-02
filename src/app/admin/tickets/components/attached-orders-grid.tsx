'use client';

import React, { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Undo2 } from 'lucide-react';
import figmaStyles from '@/utils/figma-styles.json';
import { Button } from '@/components/ui/button';
import { 
  bulkRefillOrdersAction, 
  bulkRefundOrdersAction 
} from '@/actions/support/ticket';
import { ConfirmModal } from '@/components/ui/confirm-modal';

export interface AttachedOrdersGridProps {
  orders: Array<{ id: string; numericId: number; status: import("@prisma/client").OrderStatus; charge: number; remains: number; quantity: number; link: string; createdAt: string; serviceName: string }>;
  ticketId: string;
  isApiEnabledClient: boolean;
}

export function AttachedOrdersGrid({ orders, ticketId, isApiEnabledClient }: AttachedOrdersGridProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'refill' | 'refund' | null>(null);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPending) return;
    if (e.target.checked) {
      setSelectedIds(orders.map(o => o.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string) => {
    if (isPending) return;
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleBulkRefillRequest = () => {
    if (selectedIds.length === 0) return;
    setConfirmAction('refill');
    setConfirmOpen(true);
  };

  const handleBulkRefundRequest = () => {
    if (selectedIds.length === 0) return;
    setConfirmAction('refund');
    setConfirmOpen(true);
  };

  const executeConfirm = () => {
    if (selectedIds.length === 0 || !confirmAction) return;
    setConfirmOpen(false);
    
    startTransition(async () => {
      if (confirmAction === 'refill') {
        const res = await bulkRefillOrdersAction(ticketId, selectedIds);
        if (res.success) {
          toast.success(`Массовый перезапуск: обработано ${res.processedCount} заказов.`);
          if (res.errors && res.errors.length > 0) {
            res.errors.forEach(err => toast.error(err));
          }
          setSelectedIds([]);
        } else {
          toast.error(res.error || 'Произошла непредвиденная ошибка');
        }
      } else if (confirmAction === 'refund') {
        const res = await bulkRefundOrdersAction(ticketId, selectedIds);
        if (res.success) {
          toast.success(`Массовый частичный возврат: возвращено ${res.totalRefundedAmount} ₽ по ${res.processedCount} заказам.`);
          if (res.errors && res.errors.length > 0) {
            res.errors.forEach(err => toast.error(err));
          }
          setSelectedIds([]);
        } else {
          toast.error(res.error || 'Произошла непредвиденная ошибка');
        }
      }
    });
  };

  return (
    <div className="p-4 border-b border-border bg-card select-none">
      <div 
        className="bg-muted/10 border border-border/85 space-y-4"
        style={{
          borderRadius: figmaStyles.layout.borderRadiusCard,
          padding: figmaStyles.layout.paddingCard
        }}
      >
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-black text-foreground flex items-center gap-2">
              <span>📦 Прикрепленные заказы API ({orders.length})</span>
              {isApiEnabledClient && (
                <span className="px-1.5 py-0.5 bg-warning/10 text-warning-text border border-warning/20 rounded text-[9px] font-black uppercase select-none animate-pulse">
                  API Безлимит
                </span>
              )}
            </span>
            {selectedIds.length > 0 && (
              <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full select-none">
                Выбрано: {selectedIds.length}
              </span>
            )}
            
            {orders.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground cursor-pointer select-none min-h-[44px] px-1">
                <div className="flex items-center justify-center min-h-[44px] min-w-[44px]">
                  <input 
                    type="checkbox"
                    checked={selectedIds.length === orders.length && orders.length > 0}
                    onChange={handleSelectAll}
                    disabled={isPending}
                    className="w-5 h-5 rounded border-border text-primary focus:ring-primary cursor-pointer min-h-[36px] min-w-[36px] disabled:opacity-50"
                  />
                </div>
                <span>Выбрать все</span>
              </label>
            )}
          </div>
          
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                intent="primary"
                size="sm"
                onClick={handleBulkRefillRequest}
                disabled={isPending}
                className="h-11 min-h-[44px] px-4 text-[11px] font-bold flex items-center gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200"
                style={{
                  borderRadius: figmaStyles.layout.miniAppButtonRadius,
                  padding: figmaStyles.layout.miniAppButtonPadding
                }}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span>Массовый докрут</span>
              </Button>
              <Button
                intent="destructive"
                size="sm"
                onClick={handleBulkRefundRequest}
                disabled={isPending}
                className="h-11 min-h-[44px] px-4 text-[11px] font-bold flex items-center gap-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground cursor-pointer transition-all duration-200"
                style={{
                  borderRadius: figmaStyles.layout.miniAppButtonRadius,
                  padding: figmaStyles.layout.miniAppButtonPadding
                }}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                <span>Массовый возврат</span>
              </Button>
            </div>
          )}
        </div>

        {/* Card-based Premium Grid instead of Legacy Table */}
        <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-0.5 min-w-0">
          <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-2.5 min-w-0">
            {orders.map((o) => {
              const isSelected = selectedIds.includes(o.id);
              return (
                <div 
                  key={o.id}
                  onClick={() => handleSelectRow(o.id)}
                  className={`relative p-2.5 sm:p-3 border rounded-xl cursor-pointer transition-all duration-200 min-w-0 overflow-hidden ${
                    isSelected 
                      ? 'border-primary shadow-sm bg-primary/10' 
                      : 'border-border hover:border-border/80 bg-card'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox Area expanded to at least 44x44px touch target */}
                    <div 
                      className="flex items-center justify-center min-h-[44px] min-w-[44px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectRow(o.id);
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        disabled={isPending}
                        readOnly
                        className="w-5 h-5 rounded border-border text-primary focus:ring-primary cursor-pointer min-h-[36px] min-w-[36px] pointer-events-none disabled:opacity-50"
                      />
                    </div>

                    {/* Content Block */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5 mb-1.5">
                        <span className="font-mono font-black text-xs text-foreground shrink-0">
                          #{o.numericId}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border shrink-0 ${
                          o.status === 'COMPLETED' ? 'bg-success/10 text-success border-success/20' :
                          o.status === 'IN_PROGRESS' ? 'bg-primary/10 text-primary border-primary/20' :
                          o.status === 'PENDING' ? 'bg-warning/10 text-warning-text border-warning/20' :
                          'bg-muted text-foreground border-border'
                        }`}>
                          {o.status === 'COMPLETED' ? 'Выполнен' :
                           o.status === 'IN_PROGRESS' ? 'В работе' :
                           o.status === 'PENDING' ? 'В очереди' : o.status}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-foreground truncate mb-1" title={o.serviceName}>
                        {o.serviceName}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold gap-2">
                        <div>
                          Остаток: <span className="font-bold text-foreground">{o.remains} / {o.quantity}</span>
                        </div>
                        <div className="font-black text-foreground">
                          {(o.charge / 100).toFixed(2)} ₽
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeConfirm}
        title={confirmAction === 'refill' ? 'Массовый докрут заказов' : 'Массовый возврат средств'}
        isDanger={confirmAction === 'refund'}
        confirmText={confirmAction === 'refill' ? 'Перезапустить' : 'Оформить возврат'}
      >
        {confirmAction === 'refill' ? (
          <>Вы действительно хотите запустить массовый докрут (перезапуск) для выбранных <strong>{selectedIds.length}</strong> заказов?</>
        ) : (
          <>Вы действительно хотите оформить частичный возврат средств на баланс клиента для выбранных <strong>{selectedIds.length}</strong> заказов за недовыполненные остатки?</>
        )}
      </ConfirmModal>
    </div>
  );
}
