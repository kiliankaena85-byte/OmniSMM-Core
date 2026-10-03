'use client';
import React from 'react';
import { Search, ArrowLeft, ArrowRight, Layers } from 'lucide-react';
import { SocialIcon } from '@/components/ui/SocialIcon';
import { PublicNetwork, PublicCategory } from '@/actions/order/catalog';
import { formatDetectedTargetName } from './helpers';

interface WizardStepCategoryProps {
  selectedNetwork: PublicNetwork | null;
  selectedCategory: PublicCategory | null;
  searchCategory: string;
  setSearchCategory: (val: string) => void;
  hasSmartFilter: boolean;
  detectedType: string | null;
  matchedCategories: PublicCategory[];
  showAllCategories: boolean;
  setShowAllCategories: (val: boolean) => void;
  filteredCategories: PublicCategory[];
  onBack: () => void;
  onSelectCategory: (cat: PublicCategory) => void;
}

export function WizardStepCategory({
  selectedNetwork,
  selectedCategory,
  searchCategory,
  setSearchCategory,
  hasSmartFilter,
  detectedType,
  matchedCategories,
  showAllCategories,
  setShowAllCategories,
  filteredCategories,
  onBack,
  onSelectCategory,
}: WizardStepCategoryProps) {
  return (
    <div className="bg-card/70 backdrop-blur-xl p-6 rounded-3xl border border-border/60 shadow-sm space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-muted/60 hover:bg-muted text-foreground transition-all shrink-0"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            {selectedNetwork && <SocialIcon slug={selectedNetwork.slug || selectedNetwork.name} className="w-6 h-6 shrink-0" />}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-foreground truncate min-w-0">Шаг 2: Категория ({selectedNetwork?.name})</h2>
              <p className="text-muted-foreground text-xs">Выберите направление услуги</p>
            </div>
          </div>
        </div>

        <div className="relative w-full md:w-56">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={searchCategory}
            onChange={e => setSearchCategory(e.target.value)}
            placeholder="Поиск..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-background/80 border border-border/60 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {hasSmartFilter && selectedNetwork && selectedNetwork.categories.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3 bg-primary/5 rounded-2xl border border-primary/20 text-xs text-foreground">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" />
            <span>
              Отобраны подходящие категории для ссылки:{' '}
              <strong className="font-bold text-primary">
                {formatDetectedTargetName(detectedType) || 'Определенный тип объекта'}
              </strong>{' '}
              ({matchedCategories.length} из {selectedNetwork.categories.length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowAllCategories(!showAllCategories)}
            className="text-primary hover:underline font-bold text-xs shrink-0 self-start sm:self-auto cursor-pointer"
          >
            {showAllCategories
              ? '← Показать только подходящие'
              : `Показать все категории (${selectedNetwork.categories.length}) →`}
          </button>
        </div>
      )}

      {filteredCategories.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-center bg-background/40 rounded-2xl border border-dashed border-border/60">
          <p className="text-sm font-medium text-muted-foreground">
            Нет категорий, подходящих под критерии поиска или фильтра ссылки.
          </p>
          {hasSmartFilter && (
            <button
              type="button"
              onClick={() => setShowAllCategories(true)}
              className="text-xs font-bold text-primary hover:underline"
            >
              Показать все категории этой социальной сети →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {filteredCategories.map(cat => {
            const isSelected = selectedCategory?.id === cat.id;
            const isMatchedByFilter = hasSmartFilter && matchedCategories.some(m => m.id === cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(cat)}
                className={`p-4 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/30 font-bold shadow-sm'
                    : 'border-border/60 bg-background/60 hover:bg-card hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                    <Layers className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="text-sm font-semibold text-foreground truncate min-w-0">{cat.name}</div>
                      {showAllCategories && isMatchedByFilter && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md shrink-0 border border-emerald-500/20">
                          Подходит
                        </span>
                      )}
                    </div>
                    {cat.description && (
                      <div className="text-[11px] text-muted-foreground/80 line-clamp-1 mt-0.5">{cat.description}</div>
                    )}
                    {typeof cat.serviceCount === 'number' && cat.serviceCount > 0 && (
                      <div className="text-[10px] font-medium text-muted-foreground">{cat.serviceCount} услуг</div>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
