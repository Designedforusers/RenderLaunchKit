import { BlueprintBackdrop, Nav } from './landing/BlueprintBackdrop.js';
import { Hero } from './landing/Hero.js';
import { AssetMarquee } from './landing/AssetMarquee.js';
import { PipelineScene } from './landing/PipelineScene.js';
import { BentoAssets } from './landing/BentoAssets.js';
import {
  Differentiators,
  StatsSection,
  TechStackStrip,
  FAQ,
  FinalCTA,
  Footer,
} from './landing/Sections.js';

export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-surface-950 text-text-primary">
      <BlueprintBackdrop />
      <Nav />
      <Hero />
      <AssetMarquee />
      <PipelineScene />
      <BentoAssets />
      <Differentiators />
      <StatsSection />
      <TechStackStrip />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
