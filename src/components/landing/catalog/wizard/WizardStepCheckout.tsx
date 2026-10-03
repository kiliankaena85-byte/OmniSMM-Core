'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { detectMismatchedNetwork } from '@/utils/social-link-placeholder';
import { CatalogPlatform, CatalogCategory, CatalogServiceItem } from '../catalog-data';
import { WizardPaymentGateways, type PaymentMethodType } from './WizardPaymentGateways';
import { WizardLinkField, validateOrderLink } from './WizardLinkField';
import { WizardDripFeedSection } from './WizardDripFeedSection';

export type { PaymentMethodType };

interface GatewaysConfig {
  yookassa: boolean;
  sbp?: boolean;
  robokassa: boolean;
  cryptobot: boolean;
}

interface WizardStepCheckoutProps {
  platform: CatalogPlatform;
  category: CatalogCategory;
  service: CatalogServiceItem;
  targetUrl: string;
  setTargetUrl: (url: string) => void;
  quantity: number;
  setQuantity: (qty: number) => void;
  runs?: number;
  setRuns?: (runs: number) => void;
  dripFeedEnabled?: boolean;
  setDripFeedEnabled?: (enabled: boolean) => void;
  paymentMethod: PaymentMethodType;
  setPaymentMethod: (method: PaymentMethodType) => void;
  availableGateways: GatewaysConfig | null;
  userBalanceCents: number;
  totalPrice: string;
  customData?: string;
  setCustomData?: (val: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export function WizardStepCheckout({
  platform,
  category,
  service,
  targetUrl,
  setTargetUrl,
  quantity,
  setQuantity,
  runs = 1,
  setRuns,
  dripFeedEnabled = false,
  setDripFeedEnabled,
  paymentMethod,
  setPaymentMethod,
  availableGateways,
  userBalanceCents,
  totalPrice,
  customData,
  setCustomData,
  onBack,
  onSubmit,
}: WizardStepCheckoutProps) {
  const mismatch = detectMismatchedNetwork(targetUrl, platform.id);
  const { isValid: isLinkValid, error: linkError } = validateOrderLink(targetUrl, platform.id);

  const customDataType = service.customDataType || (
    service.title.toLowerCase().includes('комментар')
      ? 'TEXTAREA'
      : (service.title.toLowerCase().includes('опрос') || service.title.toLowerCase().includes('голосован'))
        ? 'NUMBER'
        : 'NONE'
  );

  const isCustomDataValid = customDataType === 'NONE' || Boolean(customData && customData.trim().length > 0);

  const parsedMin = parseInt(service.minMax.match(/\d[\d\s]*\b/)?.[0]?.replace(/\s/g, '') || '100', 10);
  const parsedMaxMatch = service.minMax.match(/—\s*(\d[\d\s]*)\b/);
  const parsedMax = parsedMaxMatch ? parseInt(parsedMaxMatch[1].replace(/\s/g, ''), 10) : 10000;

  // Drip-Feed Floor Invariant: Q/N >= minQty
  const isDripFeedValid = !dripFeedEnabled || (Math.floor(quantity / runs) >= parsedMin);
  const canSubmit = Boolean(targetUrl && isLinkValid && !mismatch.isMismatch && isDripFeedValid && isCustomDataValid);

  return (
    <motion.div
      key="step-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
            Шаг 4: Оформление и оплата
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {platform.name} • {service.title} ({service.pricePerUnit})
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          Назад к тарифам
        </button>
      </div>

      <div className="space-y-4">
        {/* Ссылка */}
        <WizardLinkField
          targetUrl={targetUrl}
          setTargetUrl={setTargetUrl}
          platformId={platform.id}
          categoryId={category?.id}
          serviceTitle={service?.title}
          isLinkValid={isLinkValid}
          linkError={linkError}
          mismatch={mismatch}
        />

        {/* Дополнительные параметры (комментарии / опрос) */}
        {customDataType !== 'NONE' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>{service.customDataLabel || (customDataType === 'TEXTAREA' ? 'Текст комментариев' : 'Номер варианта ответа')}</span>
                <span className="text-destructive">*</span>
              </label>
            </div>
            {customDataType === 'TEXTAREA' ? (
              <textarea
                rows={3}
                value={customData || ''}
                onChange={(e) => setCustomData?.(e.target.value)}
                placeholder={service.customDataPlaceholder || "Каждый комментарий с новой строки..."}
                className="w-full px-4 py-3 text-sm bg-background border border-border/60 rounded-2xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all resize-y"
              />
            ) : (
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={customData || ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setCustomData?.(val);
                }}
                placeholder={service.customDataPlaceholder || "Например: 1 (номер варианта в опросе)"}
                className="w-full px-4 py-3 text-sm bg-background border border-border/60 rounded-2xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            )}
            <p className="text-[11px] text-muted-foreground">
              {customDataType === 'TEXTAREA'
                ? 'Напишите текст: каждая новая строка будет отправлена как отдельный комментарий'
                : 'Укажите порядковый номер варианта ответа (например: 1 для первого варианта, 2 для второго)'}
            </p>
          </div>
        )}

        {/* Количество */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {dripFeedEnabled ? 'Общее количество:' : 'Количество:'}
            </label>
            <span className="font-mono font-black text-foreground text-sm tabular-nums">
              {quantity} шт
            </span>
          </div>
          <input
            type="range"
            min={parsedMin}
            max={parsedMax}
            step={parsedMin >= 100 ? 100 : parsedMin >= 10 ? 10 : 1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
          />
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-1 px-1">
            <span>min {parsedMin}</span>
            <span>max {parsedMax}</span>
          </div>
        </div>

        {/* Drip-Feed (Плавное налитие) */}
        <WizardDripFeedSection
          dripFeedEnabled={dripFeedEnabled}
          setDripFeedEnabled={setDripFeedEnabled}
          runs={runs}
          setRuns={setRuns}
          quantity={quantity}
          setQuantity={setQuantity}
          parsedMin={parsedMin}
          isDripFeedValid={isDripFeedValid}
        />

        {/* Выбор способа оплаты */}
        <WizardPaymentGateways
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          availableGateways={availableGateways}
          userBalanceCents={userBalanceCents}
        />

        {/* Total & Submit Button */}
        <div className="pt-4 border-t border-border/80 flex items-center justify-between gap-4">
          <div>
            <span className="text-[10px] uppercase font-bold text-muted-foreground block">
              Итого к оплате
            </span>
            <span className="text-2xl font-black text-foreground font-mono tabular-nums tracking-tight">
              {totalPrice} ₽
            </span>
          </div>

          <button
            type="button"
            className={`px-6 py-3.5 min-h-[48px] text-sm font-bold rounded-2xl shadow-lg transition-all ${
              canSubmit
                ? 'bg-primary text-primary-foreground shadow-primary/25 hover:opacity-95 active:scale-98'
                : 'bg-muted text-muted-foreground shadow-none cursor-not-allowed opacity-70'
            }`}
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            Оплатить заказ →
          </button>
        </div>
      </div>
    </motion.div>
  );
}
