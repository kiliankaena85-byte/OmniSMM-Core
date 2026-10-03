'use client';
// audit-disable STR-002

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Modal, Checkbox, Chip, Alert, Input, Switch } from '@heroui/react';
import { Table } from '@/components/admin/hero-ui';
import { previewHotSwap, executeHotSwap, addServiceRoute, toggleRouteStatus, changeRoutePriority, deleteServiceRoute, ensurePrimaryRouteAction } from '@/actions/admin/routing.actions';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ProviderComparisonHub } from './ProviderComparisonHub';

interface RoutingProvider {
  id: string;
  name: string;
}

export interface RoutingServiceRoute {
  id: string;
  isPrimary: boolean;
  priority: number;
  isActive: boolean;
  providerServiceId: string;
  provider: {
    id: string;
    name: string;
  };
}

interface RoutingAuditLog {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string | Date;
  fromProviderId?: string | null;
  toProviderId?: string | null;
}

export interface RoutingComparisonItem {
  routeId: string;
  limitsMismatch: boolean;
  providerName: string;
  costPer1k?: number;
  providerId?: string;
  providerServiceId?: string;
  isPrimary?: boolean;
  isActive?: boolean;
  sla?: number;
  avgEtaSeconds?: number;
  providerMinQty?: number | null;
  providerMaxQty?: number | null;
  procurementRatePer1kUsd?: number | null;
  procurementRatePer1kRub?: number | null;
  procurementCostPerUnitUsd?: number | null;
  procurementCostPerUnitRub?: number | null;
  marginPerUnitRub?: number | null;
  markupPercent?: number | null;
  rate?: number;
  min?: number;
  max?: number;
}

export interface RoutingService {
  [key: string]: unknown;
  id: string;
}

export interface SwapPreviewData {
  currentProvider: string;
  targetProvider: string;
  unaffectedExistingOrders: number;
  estimatedDailyOrders: number;
  warning?: string | null;
}

export interface RoutingPanelClientProps {
  service: RoutingService;
  routes: RoutingServiceRoute[];
  auditLogs: RoutingAuditLog[];
  activeProviders: RoutingProvider[];
  comparisonData: RoutingComparisonItem[];
  needsRouteSeed?: boolean;
}

export function RoutingPanelClient({ service, routes, auditLogs, activeProviders, comparisonData, needsRouteSeed }: RoutingPanelClientProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const onOpen = () => setIsOpen(true);
  const onClose = () => setIsOpen(false);
  const onOpenChange = (open: boolean) => setIsOpen(open);
  
  const [selectedRoute, setSelectedRoute] = useState<RoutingServiceRoute | null>(null);
  const [previewData, setPreviewData] = useState<SwapPreviewData | null>(null);
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSeedingRoute, setIsSeedingRoute] = useState(false);

  const [newProviderId, setNewProviderId] = useState("");
  const [newExternalId, setNewExternalId] = useState("");

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [routeIdToDelete, setRouteIdToDelete] = useState<string | null>(null);

  const handleEnsurePrimaryRoute = async () => {
    setIsSeedingRoute(true);
    try {
      const res = await ensurePrimaryRouteAction(service.id);
      if (res.success) {
        toast.success(res.created ? "Первичный маршрут успешно создан" : "Маршрут уже существует");
        router.refresh();
      } else {
        toast.error(res.error || "Не удалось создать маршрут");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSeedingRoute(false);
    }
  };

  const handleOpenSwap = async (route: RoutingServiceRoute) => {
    setSelectedRoute(route);
    setPreviewData(null);
    setReason("");
    setUnderstood(false);
    onOpen();

    try {
      const res = await previewHotSwap(service.id, route.id);
      if (res.success) {
        setPreviewData(res.data as unknown as SwapPreviewData);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err));
    }
  };

  const confirmSwap = () => {
    if (!reason || reason.length < 5) {
      toast.error("Причина должна содержать минимум 5 символов");
      return;
    }
    if (!understood) {
      toast.error("Вы должны подтвердить понимание риска");
      return;
    }

    startTransition(async () => {
      try {
        if (!selectedRoute) return;
        await executeHotSwap({
          serviceId: service.id,
          newRouteId: selectedRoute.id,
          reason,
          understandRisk: understood
        });
        toast.success("Маршрут изменен");
        onClose();
      } catch (err: unknown) {
        toast.error((err instanceof Error ? err.message : String(err)));
      }
    });
  };

  const handleAddRoute = () => {
    if (!newProviderId || !newExternalId) {
      toast.error("Заполните все поля");
      return;
    }
    startTransition(async () => {
      try {
        await addServiceRoute({
          serviceId: service.id,
          providerId: newProviderId,
          providerServiceId: newExternalId,
        });
        toast.success("Маршрут добавлен");
        setNewProviderId("");
        setNewExternalId("");
      } catch (err: unknown) {
        toast.error((err instanceof Error ? err.message : String(err)));
      }
    });
  };

  const handleToggle = (routeId: string) => {
    startTransition(async () => {
      try {
        await toggleRouteStatus(routeId);
        toast.success("Статус изменен");
      } catch (err: unknown) {
        toast.error((err instanceof Error ? err.message : String(err)));
      }
    });
  };

  const handlePriority = (routeId: string, direction: 'up'|'down') => {
    startTransition(async () => {
      try {
        await changeRoutePriority(routeId, direction);
      } catch (err: unknown) {
        toast.error((err instanceof Error ? err.message : String(err)));
      }
    });
  };

  const handleDelete = (routeId: string) => {
    setRouteIdToDelete(routeId);
    setDeleteConfirmOpen(true);
  };

  const executeDelete = () => {
    if (!routeIdToDelete) return;
    const routeId = routeIdToDelete;
    setDeleteConfirmOpen(false);
    setRouteIdToDelete(null);
    startTransition(async () => {
      try {
        await deleteServiceRoute(routeId);
        toast.success("Маршрут удален");
      } catch (err: unknown) {
        toast.error((err instanceof Error ? err.message : String(err)));
      }
    });
  };

  // Sort routes by priority DESC for display
  const sortedRoutes = [...routes].sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-6">
      {/* SEED PRIMARY ROUTE BANNER */}
      {needsRouteSeed && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="font-semibold text-amber-600 dark:text-amber-400">Маршруты не настроены</h4>
            <p className="text-sm text-muted-foreground">
              Создать первичный маршрут из текущего провайдера и внешнего ID услуги?
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onPress={handleEnsurePrimaryRoute}
            isPending={isSeedingRoute}
            className="font-medium shrink-0"
          >
            Создать первичный маршрут
          </Button>
        </div>
      )}
      
      {/* ADD ROUTE FORM */}
      <Card className="p-6 shadow-sm border-l-4 border-l-default-400 bg-background">
        <h3 className="text-lg font-bold mb-4">Добавить новый маршрут</h3>
        <div className="flex flex-col md:flex-row items-end gap-4">
          <select 
            aria-label="Провайдер"
            value={newProviderId}
            onChange={(e) => setNewProviderId(e.target.value)}
            className="w-full md:max-w-xs bg-default-100 border-none rounded-lg px-4 h-14 text-sm focus:ring-2 focus:ring-primary outline-none"
          >
            <option value="" disabled>Выберите провайдера</option>
            {activeProviders?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Input 
            aria-label="External ID (ID услуги у провайдера)"
            placeholder="Например: 1234"
            value={newExternalId}
            onChange={(e) => setNewExternalId(e.target.value)}
            className="w-full md:max-w-xs"
          />
          <Button variant="primary" onPress={handleAddRoute} isPending={isPending} className="h-14 font-semibold">
            Добавить маршрут
          </Button>
        </div>
        <div className="mt-4 text-sm text-muted-foreground bg-warning-50 text-warning-800 p-3 rounded-lg border border-warning-200">
          ⚠️ <b>Внимание:</b> Авто-фейловер отключен. Добавление маршрута не делает его активным по умолчанию, если это не первый маршрут. Трафик направляется исключительно на Primary маршрут.
        </div>
      </Card>

      {/* PROVIDER COMPARISON HUB */}
      <ProviderComparisonHub 
        comparisonData={comparisonData} 
        service={service} 
        onSwap={handleOpenSwap} 
        routes={routes}
      />

      {/* ROUTES TABLE */}
      <Card className="shadow-sm">
        <div className="p-4 border-b border-divider flex justify-between items-center bg-default-50">
          <div>
            <h3 className="text-lg font-bold">Управление маршрутизацией</h3>
            <p className="text-sm text-muted-foreground">Назначение основного провайдера и резервных маршрутов</p>
          </div>
        </div>
        
        <Table aria-label="Routes table" className="w-full">
          <Table.ScrollContainer>
            <Table.Content aria-label="Routes Content">
              <Table.Header>
                <Table.Column id="provider" isRowHeader>ПРОВАЙДЕР</Table.Column>
                <Table.Column id="external_id">EXTERNAL ID</Table.Column>
                <Table.Column id="priority">ПРИОРИТЕТ</Table.Column>
                <Table.Column id="status">СТАТУС</Table.Column>
                <Table.Column id="actions">ДЕЙСТВИЯ</Table.Column>
              </Table.Header>
              <Table.Body renderEmptyState={() => "Нет доступных маршрутов"}>
                {sortedRoutes.map((route, index: number) => (
                  <Table.Row key={route.id} id={route.id} className={route.isPrimary ? "bg-success-50/50" : ""}>
                    <Table.Cell className="font-semibold">
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground">{route.provider.name}</span>
                        {route.isPrimary && <div><Chip size="sm" color="success" variant="soft">PRIMARY NODE</Chip></div>}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-sm">{route.providerServiceId}</Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2">
                        <span className="w-4 text-center font-semibold text-lg">{route.priority}</span>
                        <div className="flex flex-col gap-0.5">
                          <Button size="sm" isIconOnly variant="ghost" 
                                  isDisabled={index === 0 || isPending}
                                  onPress={() => handlePriority(route.id, 'up')}>
                            ↑
                          </Button>
                          <Button size="sm" isIconOnly variant="ghost" 
                                  isDisabled={index === sortedRoutes.length - 1 || isPending}
                                  onPress={() => handlePriority(route.id, 'down')}>
                            ↓
                          </Button>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Switch 
                        aria-label="Route status switch"
                        isSelected={route.isActive} 
                        onChange={() => handleToggle(route.id)}
                        isDisabled={isPending || route.isPrimary}
                        size="sm"
                      >
                        {route.isActive ? 'Active' : 'Disabled'}
                      </Switch>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-2">
                        {!route.isPrimary && (
                          <Button 
                            size="sm" 
                            variant="secondary" 
                            isDisabled={!route.isActive || isPending}
                            onPress={() => handleOpenSwap(route)}
                          >
                            Сделать основным
                          </Button>
                        )}
                        {!route.isPrimary && (
                          <Button 
                            size="sm" 
                            variant="danger-soft" 
                            isDisabled={isPending}
                            onPress={() => handleDelete(route.id)}
                          >
                            Удалить
                          </Button>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card>

      {/* AUDIT LOGS */}
      <Card className="shadow-sm">
        <div className="p-4 border-b border-divider">
          <h3 className="text-lg font-bold">Audit Trail</h3>
          <p className="text-sm text-muted-foreground">История изменений маршрутизации (последние 10 записей)</p>
        </div>
        <div className="p-4 space-y-4">
          {auditLogs?.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет записей</p>
          ) : (
            auditLogs?.map((log) => (
              <div key={log.id} className="text-sm border-l-2 border-primary pl-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{log.action}</span>
                  <span className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{log.reason}</p>
                {(log.fromProviderId || log.toProviderId) && (
                  <div className="mt-1 flex gap-1 items-center text-xs font-mono bg-default-100 px-2 py-1 rounded w-fit">
                    {log.fromProviderId && <span>{log.fromProviderId.slice(0,8)}</span>}
                    {log.fromProviderId && log.toProviderId && <span className="text-primary font-bold">→</span>}
                    {log.toProviderId && <span>{log.toProviderId.slice(0,8)}</span>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* HOT SWAP MODAL */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <div className="bg-background rounded-large shadow-large">
          <div className="p-6">
            <Modal.Header className="flex flex-col gap-1">
              Конфигурация Hot-Swap
            </Modal.Header>
            <Modal.Body>
              {previewData ? (
                <div className="space-y-4">
                  <Alert color="warning" title="Осторожно! Вы меняете маршрут живого трафика.">
                    Это действие мгновенно перенаправит все **новые** заказы.
                  </Alert>

                  {comparisonData?.find((item) => item.routeId === selectedRoute?.id)?.limitsMismatch && (
                    <Alert color="danger" title="⚠️ Несовместимость лимитов">
                      Лимиты выбранного провайдера не соответствуют настройкам услуги в каталоге! Заказы могут зависать с ошибками.
                    </Alert>
                  )}

                  <div className="grid grid-cols-2 gap-4 bg-default-50 p-4 rounded-xl border border-default-200">
                    <div>
                      <p className="text-sm text-muted-foreground">Текущий провайдер</p>
                      <p className="font-bold text-danger">{previewData.currentProvider}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Новый маршрут</p>
                      <p className="font-bold text-success">{previewData.targetProvider}</p>
                    </div>
                  </div>

                  <div className="bg-background border border-divider p-4 rounded-xl space-y-2">
                    <h4 className="font-bold">Dry-Run Аналитика:</h4>
                    <ul className="text-sm space-y-2 text-muted-foreground">
                      <li>🔹 <b>{previewData.unaffectedExistingOrders}</b> заказов IN_PROGRESS <span className="text-primary font-semibold">останутся у старого провайдера</span>.</li>
                      <li>🔹 Ожидается <b>~{previewData.estimatedDailyOrders}</b> новых заказов/день через целевого провайдера.</li>
                      {previewData.warning && <li className="text-warning-600">⚠️ {previewData.warning}</li>}
                    </ul>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-divider flex flex-col">
                    <label className="text-sm font-medium">Причина переключения (Audit Log)</label>
                    <textarea 
                      className="w-full bg-default-100 border-none rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary outline-none"
                      placeholder="Например: Провайдер А задерживает выполнение"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      rows={3}
                    />
                    
                    <Checkbox isSelected={understood} onChange={setUnderstood}>
                      Я понимаю риски и подтверждаю переключение
                    </Checkbox>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">Загрузка аналитики...</div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose} isDisabled={isPending}>Отмена</Button>
              <Button variant="danger" onPress={confirmSwap} isPending={isPending} isDisabled={!previewData}>
                Confirm Traffic Swap
              </Button>
            </Modal.Footer>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={executeDelete}
        title="Удаление маршрута"
        isDanger={true}
        confirmText="Удалить"
        cancelText="Отмена"
      >
        Вы действительно хотите удалить этот маршрут? Данное действие невозможно отменить.
      </ConfirmModal>
    </div>
  );
}
