'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { CatalogPlatform, CatalogCategory, CatalogServiceItem } from '../catalog-data';

interface WizardStepServiceProps {
  platform: CatalogPlatform;
  category: CatalogCategory;
  selectedService: CatalogServiceItem;
  onSelectService: (service: CatalogServiceItem) => void;
  onBack: () => void;
}

export function WizardStepService({
  platform,
  category,
  selectedService,
  onSelectService,
  onBack,
}: WizardStepServiceProps) {
  return (
    <motion.div
      key="step-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
            Шаг 3: Выберите подходящий тариф
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {platform.name} • {category.title}
          </p>
          {category.description && (
            <p className="text-xs text-muted-foreground/80 mt-1 max-w-xl">
              {category.description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          Назад
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {category.services.map((srv) => {
          const isSelected = srv.id === selectedService.id;

          return (
            <div
              key={srv.id}
              onClick={() => onSelectService(srv)}
              className={`flex flex-col justify-between p-5 min-h-[44px] rounded-2xl border cursor-pointer transition-all duration-200 group hover:shadow-lg ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-extrabold text-foreground text-sm sm:text-base tracking-tight">
                    {srv.title}
                  </h3>
                  {srv.badge && (
                    <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">
                      {srv.badge}
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>• {srv.speed}</div>
                  <div>• {srv.guarantee}</div>
                  <div>• {srv.minMax}</div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-border/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                    Цена
                  </span>
                  <span className="text-base font-black text-foreground font-mono tabular-nums">
                    {srv.pricePerUnit}
                  </span>
                </div>
                <span className="px-3.5 py-2 min-h-[44px] flex items-center text-xs font-bold bg-primary text-primary-foreground rounded-xl shadow-sm">
                  Выбрать →
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
