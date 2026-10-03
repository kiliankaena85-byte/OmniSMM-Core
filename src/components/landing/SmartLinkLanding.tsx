'use client';

import React from "react";
import { PublicNetwork, PublicService } from "@/actions/order/catalog";
import { useOrderEngine } from "@/hooks/useOrderEngine";
import { Header } from "./Header";
import dynamic from "next/dynamic";
import { type OrderFlowVariant } from "./order-engine/LayoutVariantToggle";
import { useCheckoutOrchestrator } from "./order-engine/useCheckoutOrchestrator";
import { LandingHeroArea } from "./LandingHeroArea";
import { LandingCatalogContent } from "./LandingCatalogContent";
import { LandingFooterSection } from "./LandingFooterSection";

const LandingModals = dynamic(() => import("./LandingModals").then(m => m.LandingModals), { ssr: false });
const PlanSlideOrderClient = dynamic(() => import("./order-engine/variants/PlanSlideOrderClient").then(m => m.PlanSlideOrderClient), { ssr: false });
const PlanFullscreenCheckout = dynamic(() => import("./order-engine/variants/PlanFullscreenCheckout").then(m => m.PlanFullscreenCheckout), { ssr: false });

export function SmartLinkLanding({
  initialCatalog,
  initialEmail,
  contactSettings,
  initialServiceId = "",
  initialCategoryId = "",
  initialNetworkId = "",
  userBalanceCents = 0,
  tenantId,
  customHeroTitle,
  customHeroSubtitle,
  seoHubContent,
  initialServices = [],
  initialFlow = 'classic'
}: {
  initialCatalog: PublicNetwork[];
  initialEmail?: string;
  contactSettings?: {
    SITE_NAME?: string;
    COMPANY_NAME?: string;
    SUPPORT_EMAIL?: string;
    TELEGRAM_SUPPORT_BOT?: string;
    LEGAL_INN?: string;
    LEGAL_OGRNIP?: string;
    LEGAL_ADDRESS?: string;
  };
  initialServiceId?: string;
  initialCategoryId?: string;
  initialNetworkId?: string;
  userBalanceCents?: number;
  tenantId?: string;
  customHeroTitle?: React.ReactNode;
  customHeroSubtitle?: string;
  seoHubContent?: React.ReactNode;
  initialServices?: PublicService[];
  initialFlow?: OrderFlowVariant;
}) {
  const companyName = contactSettings?.SITE_NAME || contactSettings?.COMPANY_NAME || "SMMplan";
  const [flow] = React.useState<OrderFlowVariant>(initialFlow);
  const engine = useOrderEngine(initialCatalog, initialEmail, initialServiceId, initialCategoryId, initialNetworkId, initialServices);
  const { selectedService, setSelectedService, unfilteredCatalog } = engine;

  const desktopEmailInputRef = React.useRef<HTMLInputElement>(null);
  const mobileEmailInputRef = React.useRef<HTMLInputElement>(null);
  const [isGuideOpen, setIsGuideOpen] = React.useState(false);
  const [activeLegalSlug, setActiveLegalSlug] = React.useState<string | null>(null);
  const [showCatalogModal, setShowCatalogModal] = React.useState(false);


  const orchestrator = useCheckoutOrchestrator({ engine, desktopEmailInputRef, mobileEmailInputRef });

  const handleCloseCheckout = React.useCallback(() => {
    setSelectedService(null);
  }, [setSelectedService]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col relative overflow-x-clip">
      <div className="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-b from-primary/5 to-background pointer-events-none z-0 select-none overflow-hidden" />
      <Header initialEmail={initialEmail} siteName={companyName} tenantId={tenantId} activePath="/" />

      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-2 sm:px-4 md:px-6 pt-1 md:pt-2 pb-10 md:pb-16 flex flex-col items-center relative z-10">
        <div className="absolute top-0 inset-x-0 h-[800px] z-[-1] pointer-events-none overflow-hidden premium-dot-grid" />
        <div className="absolute top-0 inset-x-0 h-[800px] z-[-1] pointer-events-none overflow-hidden bg-gradient-to-b from-transparent via-background/50 to-background" />

        <div className="absolute top-0 inset-x-0 h-[600px] z-[-2] pointer-events-none overflow-hidden select-none">
          <div className="absolute top-[10%] left-[12%] w-72 h-72 rounded-full bg-pink-500/10 dark:bg-pink-500/5 blur-3xl pointer-events-none animate-blob-1" />
          <div className="absolute top-[15%] right-[15%] w-80 h-80 rounded-full bg-primary/10 dark:bg-primary/5 blur-3xl pointer-events-none animate-blob-2" />
          <div className="absolute top-[30%] left-[30%] w-64 h-64 rounded-full bg-emerald-500/10 dark:bg-emerald-500/5 blur-3xl pointer-events-none animate-blob-3" />
        </div>

        {flow === 'slide' ? (
          <div className="w-full flex flex-col items-center animate-in fade-in duration-300">
            <div className="w-full">
              <PlanSlideOrderClient 
                initialCatalog={initialCatalog} 
                initialEmail={initialEmail} 
                tenantId={tenantId}
                userBalanceCents={userBalanceCents}
              />
            </div>
          </div>
        ) : (
          <>
            {selectedService && (
              <div className="hidden md:flex w-full flex-col items-center animate-in fade-in duration-300">
                <PlanFullscreenCheckout
                  engine={engine}
                  selectedService={selectedService}
                  onClose={handleCloseCheckout}
                  onOpenDocument={setActiveLegalSlug}
                  userBalanceCents={userBalanceCents}
                  handleCheckout={orchestrator.handleCheckout}
                  isSubmitting={orchestrator.isSubmitting}
                  checkoutError={orchestrator.checkoutError}
                />
              </div>
            )}

            <div className={selectedService ? "flex md:hidden flex-col w-full items-center" : "flex flex-col w-full items-center"}>
              <LandingHeroArea
                engine={engine}
                handleCheckout={orchestrator.handleCheckout}
                linkHasError={orchestrator.linkHasError}
                setLinkHasError={orchestrator.setLinkHasError}
                onOpenGuide={() => setIsGuideOpen(true)}
                customHeroTitle={customHeroTitle}
                customHeroSubtitle={customHeroSubtitle}
                tenantId={tenantId}
              />

              <div className="w-full max-w-[98%] xl:max-w-[1600px] mx-auto bg-content1 shadow-2xl ring-1 ring-border/20 rounded-2xl md:rounded-[2.5rem] px-1 py-3 sm:p-6 lg:p-8 mb-4 sm:mb-6 md:mb-0 relative">
                <div className="min-h-0 md:min-h-[500px] transition-all duration-300">
                <LandingCatalogContent
                  engine={engine}
                  orchestrator={orchestrator}
                  initialEmail={initialEmail}
                  unfilteredCatalog={unfilteredCatalog}
                  desktopEmailInputRef={desktopEmailInputRef}
                  mobileEmailInputRef={mobileEmailInputRef}
                  setIsGuideOpen={setIsGuideOpen}
                  setActiveLegalSlug={setActiveLegalSlug}
                  setShowCatalogModal={setShowCatalogModal}
                  userBalanceCents={userBalanceCents}
                />
              </div>
            </div>
            </div>
          </>
        )}
      </main>

      <LandingFooterSection
        seoHubContent={seoHubContent}
        companyName={companyName}
        contactSettings={contactSettings}
        tenantId={tenantId}
      />

      <LandingModals
        engine={engine}
        orchestrator={orchestrator}
        unfilteredCatalog={unfilteredCatalog}
        isGuideOpen={isGuideOpen}
        setIsGuideOpen={setIsGuideOpen}
        activeLegalSlug={activeLegalSlug}
        setActiveLegalSlug={setActiveLegalSlug}
        showCatalogModal={showCatalogModal}
        setShowCatalogModal={setShowCatalogModal}

        userBalanceCents={userBalanceCents}
      />
    </div>
  );
}
