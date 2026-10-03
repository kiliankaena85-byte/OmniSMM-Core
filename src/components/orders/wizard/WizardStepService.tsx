'use client';
import React from 'react';
import { ArrowLeft, Loader2, Info } from 'lucide-react';
import { PublicNetwork, PublicCategory, PublicService } from '@/actions/order/catalog';
import { checkServiceRefill } from '@/utils/service-refill';
import { formatEtaSpeedBadge } from '@/utils/format-eta';
import { formatPricePerUnit } from '@/utils/format-price';
import { TariffSubtypeFilter } from './types';
import { ServiceIdBadge } from '@/components/ui/service-id-badge';

interface WizardStepServiceProps {
  selectedNetwork: PublicNetwork | null;
  selectedCategory: PublicCategory | null;
  selectedService: PublicService | null;
  services: PublicService[];
  isLoadingServices: boolean;
  displayedServices: PublicService[];
  hasMultipleSubtypes: boolean;
  effectiveSubtype: 'all' | 'channel' | 'post';
  tariffSubtypeFilter: TariffSubtypeFilter;
  setTariffSubtypeFilter: (val: TariffSubtypeFilter) => void;
  channelServicesCount: number;
  postServicesCount: number;
  detectedType: string | null;
  onBack: () => void;
  onSelectService: (srv: PublicService) => void;
}

export function WizardStepService({
  selectedNetwork, selectedCategory, selectedService, services, isLoadingServices,
  displayedServices, hasMultipleSubtypes, effectiveSubtype, setTariffSubtypeFilter,
  channelServicesCount, postServicesCount, detectedType, onBack, onSelectService,
}: WizardStepServiceProps) {
  return (
    <div className="bg-card/70 backdrop-blur-xl p-6 rounded-3xl border border-border/60 shadow-sm space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="p-2 rounded-xl bg-muted/60 hover:bg-muted text-foreground transition-all shrink-0">
            <ArrowLeft className="w-4 h-4 shrink-0" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-foreground">Шаг 3: Выберите тариф / услугу</h2>
            <p className="text-muted-foreground text-xs">{selectedNetwork?.name} — {selectedCategory?.name}</p>
            {selectedCategory?.description && (
              <p className="text-xs text-muted-foreground/80 mt-1 max-w-2xl">{selectedCategory.description}</p>
            )}
          </div>
        </div>
      </div>

      {hasMultipleSubtypes && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-muted/40 rounded-2xl border border-border/50">
          <div className="flex items-center gap-1.5 p-1 bg-background/80 rounded-xl border border-border/40 overflow-x-auto scrollbar-none flex-nowrap shrink-0">
            <button type="button" onClick={() => setTariffSubtypeFilter('channel')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${effectiveSubtype === 'channel' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}>
              <span>⚡ На канал (пакеты)</span>
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${effectiveSubtype === 'channel' ? 'bg-black/20 text-white' : 'bg-muted text-muted-foreground'}`}>{channelServicesCount}</span>
            </button>
            <button type="button" onClick={() => setTariffSubtypeFilter('post')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${effectiveSubtype === 'post' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}>
              <span>📌 На отдельный пост</span>
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${effectiveSubtype === 'post' ? 'bg-black/20 text-white' : 'bg-muted text-muted-foreground'}`}>{postServicesCount}</span>
            </button>
            <button type="button" onClick={() => setTariffSubtypeFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${effectiveSubtype === 'all' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}>
              <span>Все тарифы</span>
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${effectiveSubtype === 'all' ? 'bg-black/20 text-white' : 'bg-muted text-muted-foreground'}`}>{services.length}</span>
            </button>
          </div>
          {detectedType === 'channel' && effectiveSubtype === 'post' && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-medium px-2.5 py-1 bg-amber-500/10 rounded-lg border border-amber-500/20">
              <Info className="w-3.5 h-3.5 shrink-0" /> Для этих тарифов потребуется ссылка на отдельный пост
            </span>
          )}
          {detectedType === 'post' && effectiveSubtype === 'channel' && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-medium px-2.5 py-1 bg-amber-500/10 rounded-lg border border-amber-500/20">
              <Info className="w-3.5 h-3.5 shrink-0" /> Для пакетов охвата потребуется ссылка на весь канал
            </span>
          )}
        </div>
      )}

      {isLoadingServices ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm font-medium">Загружаем список услуг...</span>
        </div>
      ) : displayedServices.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          {hasMultipleSubtypes && effectiveSubtype !== 'all' ? (
            <div className="flex flex-col items-center gap-2">
              <p>В этом подразделе пока нет тарифов.</p>
              <button type="button" onClick={() => setTariffSubtypeFilter('all')} className="text-xs font-bold text-primary hover:underline">
                Показать все тарифы категории ({services.length}) →
              </button>
            </div>
          ) : (
            'В выбранной категории пока нет доступных активных услуг.'
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayedServices.map((srv: PublicService, idx: number) => {
            const isSelected = selectedService?.id === srv.id;
            const { hasRefill, badgeLabel } = checkServiceRefill(srv);
            const isFast = srv.name.toLowerCase().includes('быстр') || srv.name.toLowerCase().includes('мгновен');
            const smartBadge = srv.badge || (hasRefill ? (badgeLabel || '🛡️ Refill') : isFast ? '⚡️ Топ скорость' : idx === 0 ? '🔥 Выбор клиентов' : null);
            return (
              <div
                key={srv.id}
                onClick={() => onSelectService(srv)}
                className={`p-5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-4 relative overflow-hidden ${
                  isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/30 shadow-md' : 'border-border/60 bg-background/60 hover:bg-card hover:border-primary/40 hover:shadow-md'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <ServiceIdBadge numericId={srv.numericId} />
                      <h3 className="font-bold text-base text-foreground line-clamp-2">{srv.name}</h3>
                    </div>
                    {smartBadge && (
                      <span className="px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 rounded-md shrink-0">
                        {smartBadge}
                      </span>
                    )}
                  </div>
                  {srv.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{srv.description}</p>}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-border/40 text-xs">
                  <div className="flex flex-col gap-1 text-muted-foreground">
                    <span className="text-primary font-bold text-[11px]">{formatEtaSpeedBadge(srv)}</span>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span>Мин: <strong>{srv.minQty}</strong></span>
                      <span>Макс: <strong>{srv.maxQty.toLocaleString('ru-RU')}</strong></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black text-primary">{formatPricePerUnit(srv.pricePerUnitRub)} ₽</span>
                    <span className="text-[10px] text-muted-foreground block">/ шт</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
