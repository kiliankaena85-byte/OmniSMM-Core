'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { CatalogPlatform, CatalogCategory } from '../catalog-data';

interface WizardStepCategoryProps {
  platform: CatalogPlatform;
  selectedCategory: CatalogCategory;
  onSelectCategory: (category: CatalogCategory) => void;
  onBack: () => void;
}

export function WizardStepCategory({
  platform,
  selectedCategory,
  onSelectCategory,
  onBack,
}: WizardStepCategoryProps) {
  return (
    <motion.div
      key="step-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
            Шаг 2: Выберите категорию ({platform.name})
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Какое целевое действие вам требуется?
          </p>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {platform.categories.map((cat) => {
          const isSelected = cat.id === selectedCategory.id;

          return (
            <button
              key={cat.id}
              type="button"
              className={`flex items-center justify-between p-4 sm:p-5 min-h-[44px] rounded-2xl border text-left transition-all duration-200 group hover:shadow-md ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
              onClick={() => onSelectCategory(cat)}
            >
              <div className="space-y-1 min-w-0 flex-1 pr-2">
                <div className="font-extrabold text-foreground text-sm sm:text-base tracking-tight truncate">
                  {cat.title}
                </div>
                {cat.description && (
                  <div className="text-xs text-muted-foreground/80 line-clamp-2">
                    {cat.description}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {cat.services.length} доступных тарифов
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
