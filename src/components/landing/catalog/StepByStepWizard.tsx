'use client';

import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ALL_PLATFORMS, CatalogPlatform, CatalogCategory, CatalogServiceItem } from './catalog-data';
import { WizardProgress } from './wizard/WizardProgress';
import { WizardStepPlatform } from './wizard/WizardStepPlatform';
import { WizardStepCategory } from './wizard/WizardStepCategory';
import { WizardStepService } from './wizard/WizardStepService';
import { WizardStepCheckout, PaymentMethodType } from './wizard/WizardStepCheckout';

export function StepByStepWizard({
  onCompleteOrder,
  userBalanceCents = 0,
}: {
  onCompleteOrder?: (orderData: {
    platform: string;
    category: string;
    service: CatalogServiceItem;
    targetUrl: string;
    quantity: number;
    runs?: number;
    customData?: string;
    paymentMethod: string;
  }) => void;
  userBalanceCents?: number;
}) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedPlatform, setSelectedPlatform] = useState<CatalogPlatform>(ALL_PLATFORMS[0]);
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory>(ALL_PLATFORMS[0].categories[0]);
  const [selectedService, setSelectedService] = useState<CatalogServiceItem>(
    ALL_PLATFORMS[0].categories[0].services[0]
  );

  // Step 4 Form State
  const [targetUrl, setTargetUrl] = useState('');
  const [customData, setCustomData] = useState('');
  const [quantity, setQuantity] = useState(500);
  const [runs, setRuns] = useState(1);
  const [dripFeedEnabled, setDripFeedEnabled] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('sbp');
  const [availableGateways, setAvailableGateways] = useState<{
    yookassa: boolean;
    sbp?: boolean;
    robokassa: boolean;
    cryptobot: boolean;
  } | null>(null);

  useEffect(() => {
    import('@/actions/order/checkout').then(({ getAvailableGatewaysAction }) => {
      getAvailableGatewaysAction().then((res) => {
        if (res.success && res.data) {
          setAvailableGateways(res.data);
          const data = res.data;
          const isCurrentActive =
            (paymentMethod === 'sbp' && data.yookassa) ||
            (paymentMethod === 'card' && data.yookassa) ||
            (paymentMethod === 'crypto' && data.cryptobot);

          if (!isCurrentActive) {
            if (data.yookassa) setPaymentMethod('sbp');
            else if (data.cryptobot) setPaymentMethod('crypto');
          }
        }
      });
    });
  }, [paymentMethod]);

  // Price calculations
  const pricePerUnitNumeric = parseFloat(selectedService.pricePerUnit.replace(/[^0-9.]/g, '')) || 0.18;
  const totalPrice = (quantity * pricePerUnitNumeric).toFixed(2);

  const steps = [
    { num: 1, title: 'Соцсеть', desc: selectedPlatform.name },
    { num: 2, title: 'Категория', desc: selectedCategory.title },
    { num: 3, title: 'Тариф', desc: selectedService.title.slice(0, 18) + '...' },
    { num: 4, title: 'Оплата', desc: `${totalPrice} ₽` },
  ];

  const handleSelectPlatform = (platform: CatalogPlatform) => {
    setSelectedPlatform(platform);
    if (platform.categories.length > 0) {
      setSelectedCategory(platform.categories[0]);
      if (platform.categories[0].services.length > 0) {
        setSelectedService(platform.categories[0].services[0]);
      }
    }
    setCurrentStep(2);
  };

  const handleSelectCategory = (cat: CatalogCategory) => {
    setSelectedCategory(cat);
    if (cat.services.length > 0) {
      setSelectedService(cat.services[0]);
    }
    setCurrentStep(3);
  };

  const handleSelectService = (srv: CatalogServiceItem) => {
    setSelectedService(srv);
    setCurrentStep(4);
  };

  const handleSubmitOrder = () => {
    onCompleteOrder?.({
      platform: selectedPlatform.name,
      category: selectedCategory.title,
      service: selectedService,
      targetUrl,
      quantity,
      // Pass runs if Drip-Feed is active
      ...(dripFeedEnabled ? { runs } : {}),
      customData: customData ? customData.trim() : undefined,
      paymentMethod,
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <WizardProgress steps={steps} currentStep={currentStep} onStepClick={setCurrentStep} />

      <div className="p-6 sm:p-8 rounded-3xl bg-card border border-border/80 shadow-sm min-h-[420px] flex flex-col justify-between">
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <WizardStepPlatform
              platforms={ALL_PLATFORMS}
              selectedPlatform={selectedPlatform}
              onSelectPlatform={handleSelectPlatform}
            />
          )}

          {currentStep === 2 && (
            <WizardStepCategory
              platform={selectedPlatform}
              selectedCategory={selectedCategory}
              onSelectCategory={handleSelectCategory}
              onBack={() => setCurrentStep(1)}
            />
          )}

          {currentStep === 3 && (
            <WizardStepService
              platform={selectedPlatform}
              category={selectedCategory}
              selectedService={selectedService}
              onSelectService={handleSelectService}
              onBack={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 4 && (
            <WizardStepCheckout
              platform={selectedPlatform}
              category={selectedCategory}
              service={selectedService}
              targetUrl={targetUrl}
              setTargetUrl={setTargetUrl}
              quantity={quantity}
              setQuantity={setQuantity}
              runs={runs}
              setRuns={setRuns}
              dripFeedEnabled={dripFeedEnabled}
              setDripFeedEnabled={setDripFeedEnabled}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
              availableGateways={availableGateways}
              userBalanceCents={userBalanceCents}
              totalPrice={totalPrice}
              customData={customData}
              setCustomData={setCustomData}
              onBack={() => setCurrentStep(3)}
              onSubmit={handleSubmitOrder}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
