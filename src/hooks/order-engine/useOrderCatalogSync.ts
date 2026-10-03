'use client';

import { useState, useEffect, useRef } from 'react';
import {
  getServicesByCategoryAction,
  PublicNetwork,
  PublicCategory,
  PublicService,
  getPublicCatalogAction,
  getFreshServiceAction,
} from '@/actions/order/catalog';
import { isLinkServiceCompatible } from '@/constants/link-service-compatibility';
import { resolveServiceTargetType } from '@/utils/target-type-mapper';
import { sortCategories } from './category-demand-sorter';
import { toast } from 'sonner';

interface UseOrderCatalogSyncOptions {
  sortedInitialCatalog: PublicNetwork[];
  initialNetworkId: string;
  initialCategoryId: string;
  initialServiceId: string;
  initialServices: PublicService[];
  defaultCat: PublicCategory | null;
  networkId?: string;
  setNetworkId: React.Dispatch<React.SetStateAction<string>>;
  categoryId: string;
  setCategoryId: React.Dispatch<React.SetStateAction<string>>;
  selectedServiceRef: React.MutableRefObject<PublicService | null>;
  setSelectedService: React.Dispatch<React.SetStateAction<PublicService | null>>;
  detectedType: string | null;
  url: string;
  onResetDrip?: () => void;
}

export function useOrderCatalogSync({
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
  onResetDrip,
}: UseOrderCatalogSyncOptions) {
  const [catalog, setCatalog] = useState<PublicNetwork[]>(sortedInitialCatalog);
  const [services, setServices] = useState<PublicService[]>(initialServices);
  const [isServicesLoading, setIsServicesLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const isInitialServicesMount = useRef(initialServices.length > 0);
  const serviceRequestIdRef = useRef(0);
  const hasFetchedCatalog = useRef(false);
  const categoryServicesCache = useRef<Record<string, PublicService[]>>(
    initialCategoryId && initialServices.length > 0 ? { [initialCategoryId]: initialServices } : {}
  );

  // Initial Catalog Load
  useEffect(() => {
    if (catalog.length === 0 && !hasFetchedCatalog.current) {
      hasFetchedCatalog.current = true;
      getPublicCatalogAction().then((res) => {
        if (res.success && res.data) {
          const sortedData = res.data.map((net) => ({
            ...net,
            categories: sortCategories(net.categories),
          }));
          setCatalog(sortedData);

          let targetNetId = initialNetworkId;
          let targetCatId = initialCategoryId;
          if (!targetNetId && sortedData.length > 0) {
            const defNet = sortedData.find((n: PublicNetwork) => n.slug === 'telegram') || sortedData[0];
            if (defNet) {
              targetNetId = defNet.id;
              const defCatItem =
                defNet.categories.find((c: PublicCategory) => c.name.toLowerCase().includes('подписчики')) ||
                defNet.categories[0];
              if (defCatItem) targetCatId = defCatItem.id;
            }
          }
          if (targetNetId) {
            setNetworkId(targetNetId);
          }
          if (targetCatId) {
            setCategoryId(targetCatId);
          }
        }
      });
    } else if (catalog.length > 0 && initialNetworkId && !hasFetchedCatalog.current) {
      hasFetchedCatalog.current = true;
      setNetworkId(initialNetworkId);
      if (initialCategoryId) setCategoryId(initialCategoryId);
    }
  }, [catalog.length, initialNetworkId, initialCategoryId, setNetworkId, setCategoryId]);

  const isLinkFilled = Boolean(url && url.trim().length >= 5);

  // Load Services when Category changes
  useEffect(() => {
    if (isInitialServicesMount.current && (categoryId === defaultCat?.id || categoryId === initialCategoryId) && initialServices.length > 0) {
      isInitialServicesMount.current = false;
      categoryServicesCache.current[categoryId] = initialServices;
      if (initialServiceId && !selectedServiceRef.current) {
        const found = initialServices.find((s) => s.id === initialServiceId);
        if (found) setSelectedService(found);
      }
      return;
    }
    isInitialServicesMount.current = false;

    if (!categoryId) {
      setServices([]);
      setServicesError(null);
      if (!selectedServiceRef.current) setSelectedService(null);
      setIsServicesLoading(false);
      onResetDrip?.();
      return;
    }

    const cachedSvcs = categoryServicesCache.current[categoryId];
    if (cachedSvcs && cachedSvcs.length > 0) {
      let finalSvcs = cachedSvcs;
      if (detectedType && isLinkFilled && !selectedServiceRef.current) {
        const filtered = cachedSvcs.filter((s) => isLinkServiceCompatible(detectedType, resolveServiceTargetType(s)));
        finalSvcs = filtered.length > 0 ? filtered : cachedSvcs;
      }
      setServices(finalSvcs);
      setServicesError(null);
      setIsServicesLoading(false);
      if (initialServiceId && !selectedServiceRef.current) {
        const found = finalSvcs.find((s) => s.id === initialServiceId);
        if (found) setSelectedService(found);
      }
      return;
    }

    // Keep previous services in view to eliminate layout thrashing and skeleton flickering
    setServicesError(null);
    if (!selectedServiceRef.current) setSelectedService(null);
    const currentRequestId = ++serviceRequestIdRef.current;

    const loadServices = async () => {
      setIsServicesLoading(true);
      setServicesError(null);
      try {
        const svcs = await getServicesByCategoryAction(categoryId);
        if (currentRequestId !== serviceRequestIdRef.current) return;

        const sortedSvcs = [...svcs].sort((a, b) => {
          const aQuarantined = a.cooldownUntil && new Date(a.cooldownUntil) > new Date();
          const bQuarantined = b.cooldownUntil && new Date(b.cooldownUntil) > new Date();
          if (aQuarantined && !bQuarantined) return 1;
          if (!aQuarantined && bQuarantined) return -1;
          return 0;
        });

        categoryServicesCache.current[categoryId] = sortedSvcs;
        let finalSvcs = sortedSvcs;
        if (detectedType && isLinkFilled && !selectedServiceRef.current) {
          const filtered = sortedSvcs.filter((s) => isLinkServiceCompatible(detectedType, resolveServiceTargetType(s)));
          finalSvcs = filtered.length > 0 ? filtered : sortedSvcs;
        }

        setServices(finalSvcs);
        setServicesError(null);
        if (initialServiceId && !selectedServiceRef.current) {
          const found = finalSvcs.find((s) => s.id === initialServiceId);
          if (found) setSelectedService(found);
        } else if (!selectedServiceRef.current) {
          setSelectedService(null);
        }
      } catch (err: unknown) {
        if (currentRequestId !== serviceRequestIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Failed to load services:', err);
        setServices([]);
        setServicesError(msg || 'Не удалось загрузить услуги');
        if (!selectedServiceRef.current) setSelectedService(null);
        toast.error('Не удалось загрузить услуги. Проверьте подключение к сети.');
      } finally {
        if (currentRequestId === serviceRequestIdRef.current) {
          setIsServicesLoading(false);
        }
      }
    };

    loadServices();
  }, [
    categoryId,
    defaultCat?.id,
    initialServiceId,
    initialServices,
    detectedType,
    isLinkFilled,
    onResetDrip,
    selectedServiceRef,
    setSelectedService,
    retryCount,
  ]);

  const retryServices = () => {
    if (!categoryId) return;
    delete categoryServicesCache.current[categoryId];
    setServicesError(null);
    setRetryCount((c) => c + 1);
  };

  // Background prefetch: quietly warm up services for other categories in active network
  useEffect(() => {
    if (!catalog.length) return;
    const currentNetId = networkId || initialNetworkId;
    const activeNet = catalog.find((n) => n.id === currentNetId) || catalog[0];
    if (!activeNet?.categories) return;

    const uncachedCats = activeNet.categories.filter(
      (c) => c.id && c.id !== categoryId && !categoryServicesCache.current[c.id]
    );
    if (uncachedCats.length === 0) return;

    let isCancelled = false;
    const prefetchTimer = setTimeout(async () => {
      // Warm up uncached categories concurrently with fail-safe error isolation
      await Promise.allSettled(
        uncachedCats.map(async (cat) => {
          if (isCancelled || categoryServicesCache.current[cat.id]) return;
          try {
            const svcs = await getServicesByCategoryAction(cat.id);
            if (!isCancelled && svcs && svcs.length > 0) {
              categoryServicesCache.current[cat.id] = svcs;
            }
          } catch {
            // Non-blocking prefetch failure is intentionally ignored
          }
        })
      );
    }, 50);

    return () => {
      isCancelled = true;
      clearTimeout(prefetchTimer);
    };
  }, [catalog, categoryId, networkId, initialNetworkId]);

  // Live Sync on focus & visibilitychange (throttled to at most once per 30s)
  useEffect(() => {
    let lastSyncTime = 0;

    const handleSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastSyncTime < 30000) return; // 30s throttle
      lastSyncTime = now;

      if (selectedServiceRef.current?.id) {
        getFreshServiceAction(selectedServiceRef.current.id)
          .then((fresh) => {
            if (fresh) {
              setSelectedService((prev) => {
                if (!prev || prev.id !== fresh.id) return prev;
                if (
                  prev.pricePerUnitRub !== fresh.pricePerUnitRub ||
                  prev.minQty !== fresh.minQty ||
                  prev.maxQty !== fresh.maxQty ||
                  prev.description !== fresh.description ||
                  prev.name !== fresh.name ||
                  prev.isActive !== fresh.isActive
                ) {
                  return fresh;
                }
                return prev;
              });
            }
          })
          .catch(() => {});
      }
    };

    window.addEventListener('focus', handleSync);
    document.addEventListener('visibilitychange', handleSync);
    return () => {
      window.removeEventListener('focus', handleSync);
      document.removeEventListener('visibilitychange', handleSync);
    };
  }, [selectedServiceRef, setSelectedService]);

  return {
    catalog,
    setCatalog,
    services,
    setServices,
    isServicesLoading,
    categoryServicesCache,
    servicesError,
    retryServices,
  };
}
