import { Link } from 'react-router-dom';
import { useScroll, useTransform, motion } from 'framer-motion';
import {
  RocketLaunch,
  GithubLogo,
  Lightning,
} from '@phosphor-icons/react';

// ─────────────────────────────────────────────────────────────────────
// Section: Blueprint backdrop — subtle grid + vignette behind the page
// ─────────────────────────────────────────────────────────────────────

export function BlueprintBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    >
      {/* Faint grid — a blueprint/schematic texture. 1px lines at very low
          opacity. Repeats forever at 56px, fades at the edges via mask. */}
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(139,123,168,0.08) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(139,123,168,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse at 50% 20%, black 40%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at 50% 20%, black 40%, transparent 85%)',
        }}
      />
      {/* Accent halo — a very soft emerald glow behind the hero */}
      <div className="absolute left-1/2 top-[-240px] h-[720px] w-[1100px] -translate-x-1/2 rounded-full bg-accent-500/[0.08] blur-[160px]" />
      {/* Grain — a 1px noise overlay for that "printed" feel */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Sticky nav
// ─────────────────────────────────────────────────────────────────────

export function Nav() {
  const { scrollY } = useScroll();
  const bgOpacity = useTransform(scrollY, [0, 80], [0, 0.85]);
  const borderOpacity = useTransform(scrollY, [0, 80], [0, 1]);

  return (
    <motion.nav
      className="sticky top-0 z-50 w-full backdrop-blur-xl"
      style={{
        backgroundColor: useTransform(
          bgOpacity,
          (o) => `rgba(2,6,23,${o.toFixed(3)})`
        ),
        borderBottom: useTransform(
          borderOpacity,
          (o) => `1px solid rgba(30,41,59,${o.toFixed(3)})`
        ),
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="group flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500">
            <RocketLaunch weight="fill" size={18} className="text-white" />
            <span className="absolute inset-0 -z-10 rounded-lg bg-accent-500/40 blur-md" />
          </div>
          <span className="font-display text-heading-lg text-text-primary">
            LaunchKit
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <a href="#pipeline" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            Pipeline
          </a>
          <a href="#assets" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            Assets
          </a>
          <a href="#why" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            Why it works
          </a>
          <a href="#faq" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            FAQ
          </a>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/Designedforusers/RenderLaunchKit"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-surface-800 bg-surface-900/70 px-3 py-1.5 text-body-xs text-text-tertiary transition-colors hover:border-surface-700 hover:text-text-primary md:flex"
          >
            <GithubLogo size={14} weight="fill" />
            <span>Star on GitHub</span>
          </a>
          <Link
            to="/app"
            className="hidden items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-body-xs font-semibold text-white shadow-sm transition-all hover:bg-accent-400 md:flex"
          >
            <Lightning size={14} weight="fill" />
            <span>Generate</span>
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}
