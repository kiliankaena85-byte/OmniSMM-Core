'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { PublicNetwork, PublicService } from '@/actions/order/catalog';
import { formatCents } from '@/lib/utils';
import { toast } from 'sonner';

import { sortCategories } from './order-engine/category-demand-sorter';
import {
  restoreDraftFromSession,
  saveDraftToSession,
  restorePendingOrderSnapshot,
} from './order-engine/order-session-storage';
import { useOrderPricingEngine } from './order-engine/useOrderPricingEngine';
import { validateOrderForm } from './order-engine/order-form-validator';
import { useOrderDripState } from './order-engine/useOrderDripState';
import { useOrderCatalogSync } from './order-engine/useOrderCatalogSync';
import { useOrderUrlAnalyzer } from './order-engine/useOrderUrlAnalyzer';

export type OrderEngine = ReturnType<typeof useOrderEngine>;

export function useOrderEngine(
  initialCatalog: PublicNetwork[] = [],
  initialEmail: string = '',
  initialServiceId: string = '',
  initialCategoryId: string = '',
  initialNetworkId: string = '',
  initialServices: PublicService[] = []
) {
  const sortedInitialCatalog: PublicNetwork[] = useMemo(() => {
    return initialCatalog.map((net) => ({
      ...net,
      categories: sortCategories(net.categories),
    }));
  }, [initialCatalog]);

  const defaultNet = initialNetworkId
    ? sortedInitialCatalog.find((n) => n.id === initialNetworkId) || null
    : sortedInitialCatalog.find((n) => n.slug === 'telegram') || sortedInitialCatalog[0] || null;
  const defaultCat =
    defaultNet && initialCategoryId
      ? defaultNet.categories.find((c) => c.id === initialCategoryId) || null
      : defaultNet?.categories.find((c) => c.name.toLowerCase().includes('подписчики')) ||
        defaultNet?.categories[0] ||
        null;

  const [url, setUrl] = useState('');
  const [networkId, setNetworkId] = useState(defaultNet?.id || '');
  const [categoryId, setCategoryId] = useState(defaultCat?.id || '');
  const [selectedService, setSelectedService] = useState<PublicService | null>(null);
  const [quantity, setQuantity] = useState(100);
  const [email, setEmail] = useState(initialEmail);
  const [customData, setCustomData] = useState('');
  const [mediaGroupUrl, setMediaGroupUrl] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLinkOverridden, setIsLinkOverridden] = useState(false);
  const [isWarningConfirmed, setIsWarningConfirmed] = useState(false);
  const [warningHasError, setWarningHasError] = useState(false);
  const [termsHasError, setTermsHasError] = useState(false);

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [urlMutatedTrigger, setUrlMutatedTrigger] = useState(false);

  const isImmediateRef = useRef(false);
  const selectedServiceRef = useRef<PublicService | null>(null);
  const networkIdRef = useRef(networkId);
  const categoryIdRef = useRef(categoryId);

  useEffect(() => {
    selectedServiceRef.current = selectedService;
    networkIdRef.current = networkId;
    categoryIdRef.current = categoryId;
  }, [selectedService, networkId, categoryId]);

  // Sub-hook 1: Drip-Feed and Smart Drip state
  const {
    dripFeedEnabled,
    setDripFeedEnabled,
    runs,
    setRuns,
    dripInterval,
    setDripInterval,
    isSmartDrip,
    setIsSmartDrip,
    smartDripDays,
    setSmartDripDays,
    resetDripState,
  } = useOrderDripState();

  const [detectedType, setDetectedType] = useState<string | null>(null);
  const categoryServicesCache = useRef<Record<string, PublicService[]>>(
    initialCategoryId && initialServices.length > 0 ? { [initialCategoryId]: initialServices } : {}
  );

  // Sub-hook 2: Catalog loading, services fetching and live focus sync
  const {
    catalog,
    services,
    isServicesLoading,
    servicesError,
    retryServices,
  } = useOrderCatalogSync({
    sortedInitialCatalog,
    initialNetworkId,
    initialCategoryId,
    initialServiceId,
    initialServices,
    defaultCat,
    networkId,
    setNetworkId,
    categoryId,
    setCategoryId,
    selectedServiceRef,
    setSelectedService,
    detectedType,
    url,
    onResetDrip: resetDripState,
  });

  // Sub-hook 3: URL Intelligence, platform inference, suggested categories, compatibility checks
  const {
    platform,
    manualPlatform,
    setManualPlatform,
    suggestedCategories,
    urlHint,
    isAnalyzingUrl,
    computeAvailableCategories,
    compatibilityWarning,
  } = useOrderUrlAnalyzer({
    url,
    catalog,
    selectedService,
    selectedServiceRef,
    networkIdRef,
    categoryIdRef,
    setNetworkId,
    setCategoryId,
    isLinkOverridden,
    isImmediateRef,
    categoryServicesCache,
    detectedType,
    setDetectedType,
  });

  // Session & Snapshot Restoration
  useEffect(() => {
    restoreDraftFromSession(sortedInitialCatalog, setUrl, setNetworkId, setCategoryId, setQuantity);
    restorePendingOrderSnapshot({
      setUrl,
      setNetworkId,
      setCategoryId,
      setQuantity,
      setEmail,
      setPromoCode,
      setCustomData,
      setRuns,
      setDripFeedEnabled,
      setDripInterval,
      setIsSmartDrip,
      setSmartDripDays,
      setSelectedService,
    });
  }, [sortedInitialCatalog, setRuns, setDripFeedEnabled, setDripInterval, setIsSmartDrip, setSmartDripDays]);

  useEffect(() => {
    saveDraftToSession({ url, networkId, categoryId, quantity });
  }, [url, networkId, categoryId, quantity]);

  // Reset category on URL length transition when no service is selected
  const prevUrlRef = useRef('');
  useEffect(() => {
    const prevUrl = prevUrlRef.current;
    if (url.trim().length >= 5 && prevUrl.trim().length < 5 && !selectedServiceRef.current) {
      setCategoryId('');
    }
    prevUrlRef.current = url;
  }, [url]);

  const handleSetUrl = useCallback((newUrl: string, immediate = false) => {
    if (immediate) isImmediateRef.current = true;
    setUrl(newUrl);
    setIsLinkOverridden(false);
    setIsWarningConfirmed(false);
    setWarningHasError(false);
    if (!newUrl) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next.link;
        return next;
      });
    }
  }, []);

  // Update quantity limits and reset drip state when Service changes
  useEffect(() => {
    if (selectedService) {
      setQuantity(selectedService.minQty);
      resetDripState();
      setIsLinkOverridden(false);
      setIsWarningConfirmed(false);
      setWarningHasError(false);
    }
  }, [selectedService, resetDripState]);

  // Sub-hook 4: Pricing Engine
  const { pricing, pricingError, isCalculating } = useOrderPricingEngine({
    selectedService,
    quantity,
    promoCode,
    dripFeedEnabled,
    runs,
    isSmartDrip,
  });

  // Form Validation
  const validate = useCallback(
    (shouldMutate = false) => {
      const res = validateOrderForm({
        url,
        quantity,
        email,
        selectedService,
        customData,
        agreedToTerms,
        catalog,
        networkId,
        platform,
        manualPlatform,
        detectedType,
        isLinkOverridden,
        dripFeedEnabled,
        runs,
        isSmartDrip,
        smartDripDays,
        shouldMutate,
      });

      if (res.cleanUrl && res.cleanUrl !== url) {
        setUrl(res.cleanUrl);
        toast.success('Ссылка автоматически скорректирована под выбранный тип услуги!');
        setUrlMutatedTrigger(true);
        setTimeout(() => setUrlMutatedTrigger(false), 2000);
      }

      setValidationErrors(res.errors);
      return res.isValid;
    },
    [
      url,
      quantity,
      email,
      selectedService,
      customData,
      agreedToTerms,
      catalog,
      networkId,
      platform,
      manualPlatform,
      detectedType,
      isLinkOverridden,
      dripFeedEnabled,
      runs,
      isSmartDrip,
      smartDripDays,
    ]
  );

  useEffect(() => {
    validate(false);
  }, [
    url,
    selectedService,
    email,
    quantity,
    customData,
    agreedToTerms,
    networkId,
    categoryId,
    dripFeedEnabled,
    runs,
    isSmartDrip,
    smartDripDays,
    validate,
  ]);

  // Multipliers & Formatting
  const mediaGroupMultiplier = mediaGroupUrl.trim().length > 5 ? 2 : 1;
  const finalCents = pricing ? pricing.totalCents * mediaGroupMultiplier : 0;
  const totalPriceFormatted = finalCents > 0 ? formatCents(finalCents) : formatCents(0);

  const activeNetwork = catalog.find((n) => n.id === networkId) || catalog[0] || null;
  const availableCategories = computeAvailableCategories(activeNetwork);

  return {
    url,
    setUrl: handleSetUrl,
    networkId,
    setNetworkId,
    categoryId,
    setCategoryId,
    selectedService,
    setSelectedService,
    quantity,
    setQuantity,
    email,
    setEmail,
    customData,
    setCustomData,
    mediaGroupUrl,
    setMediaGroupUrl,
    promoCode,
    setPromoCode,
    agreedToTerms,
    setAgreedToTerms,
    isLinkOverridden,
    setIsLinkOverridden,
    isWarningConfirmed,
    setIsWarningConfirmed,
    warningHasError,
    setWarningHasError,
    termsHasError,
    setTermsHasError,
    dripFeedEnabled,
    setDripFeedEnabled,
    runs,
    setRuns,
    dripInterval,
    setDripInterval,
    isSmartDrip,
    setIsSmartDrip,
    smartDripDays,
    setSmartDripDays,
    platform,
    detectedType,
    suggestedCategories,
    manualPlatform,
    setManualPlatform,
    activeNetwork,
    catalog,
    unfilteredCatalog: catalog,
    availableCategories,
    services,
    pricing,
    pricingError,
    totalPriceFormatted,
    mediaGroupMultiplier,
    isLoading: isAnalyzingUrl || isServicesLoading,
    isServicesLoading,
    isAnalyzingUrl,
    isCalculating,
    error: servicesError || null,
    servicesError,
    retryServices,
    validationErrors,
    compatibilityWarning,
    urlMutatedTrigger,
    urlHint,
    validate,
    resetOrder: useCallback(() => {
      setUrl('');
      setSelectedService(null);
      setPromoCode('');
      setIsLinkOverridden(false);
      setIsWarningConfirmed(false);
      setWarningHasError(false);
      setTermsHasError(false);
      setValidationErrors({});
      try {
        sessionStorage.removeItem('smmplan_draft');
      } catch {
        /* SSR */
      }
    }, []),
  };
}
