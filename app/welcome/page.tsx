"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/data/provider";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Feature cards ("See what BudgetSim does")
// ---------------------------------------------------------------------------

const FEATURES = [
  { icon: "▤", tag: "track", key: "f1" },
  { icon: "◧", tag: "glance", key: "f2" },
  { icon: "💳", tag: "cards", key: "f3" },
  { icon: "✓", tag: "earn", key: "f4" },
  { icon: "↻", tag: "plan", key: "f5" },
  { icon: "◔", tag: "stats", key: "f6" },
  { icon: "↗", tag: "simulate", key: "f7" },
  { icon: "⌂", tag: "debt", key: "f8" },
] as const;

// ---------------------------------------------------------------------------
// Brand icons
// ---------------------------------------------------------------------------

function WalletIcon() {
  return (
    <svg className="h-12 w-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GlobeBrandIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

const SOCIAL_LINKS: Array<{ href: string; label: string; Icon: () => React.ReactElement }> = [
  { href: "https://ardacanbakis.com", label: "Website", Icon: GlobeBrandIcon },
  { href: "https://github.com/ardacanbakis", label: "GitHub", Icon: GithubIcon },
  { href: "https://www.instagram.com/arda.canbakiss/", label: "Instagram", Icon: InstagramIcon },
  { href: "https://www.youtube.com/@arda.canbakis", label: "YouTube", Icon: YoutubeIcon },
  { href: "https://open.spotify.com/user/11146430303", label: "Spotify", Icon: SpotifyIcon },
  { href: "http://linkedin.com/in/ardacanbakis", label: "LinkedIn", Icon: LinkedinIcon },
];

// ---------------------------------------------------------------------------
// Background — pulsing neon grid spelling T-H-E-O
// ---------------------------------------------------------------------------

const ACTIVE_CELLS: Array<[number, number]> = [
  // T — top-left
  [1, 1], [2, 1], [3, 1], [4, 1], [5, 1],
  [3, 2], [3, 3], [3, 4], [3, 5],
  // H — top-right
  [10, 1], [14, 1], [10, 2], [14, 2],
  [10, 3], [11, 3], [12, 3], [13, 3], [14, 3],
  [10, 4], [14, 4], [10, 5], [14, 5],
  // E — bottom-left
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [1, 9],
  [1, 10], [2, 10], [3, 10], [4, 10],
  [1, 11],
  [1, 12], [2, 12], [3, 12], [4, 12], [5, 12],
  // O — bottom-right
  [11, 8], [12, 8], [13, 8],
  [10, 9], [14, 9],
  [10, 10], [14, 10],
  [10, 11], [14, 11],
  [11, 12], [12, 12], [13, 12],
];

function NeonGrid({ dark }: { dark: boolean }) {
  const accent = dark ? "#22d3ee" : "#3b82f6";
  const accentSoft = dark ? "rgba(34,211,238,0.5)" : "rgba(59,130,246,0.45)";
  const lineColor = dark ? "rgba(148, 163, 184, 0.08)" : "rgba(71, 85, 105, 0.10)";
  const cols = 16;
  const rows = 14;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${lineColor} 1px, transparent 1px), linear-gradient(90deg, ${lineColor} 1px, transparent 1px)`,
          backgroundSize: "6vmin 6vmin",
          animation: "welcome-grid-fade 1.5s ease-out both",
        }}
      />
      <div
        className="absolute inset-0 grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      >
        {ACTIVE_CELLS.map(([c, r], i) => {
          const delay = (i % 7) * 0.18 + (r % 3) * 0.12;
          const dur = 2.2 + ((i * 13) % 9) / 10;
          return (
            <div
              key={`${c}-${r}`}
              style={{
                gridColumn: c + 1,
                gridRow: r + 1,
                margin: "12%",
                background: accent,
                borderRadius: "2px",
                boxShadow: `0 0 12px ${accent}, 0 0 24px ${accentSoft}`,
                opacity: 0,
                animation: `welcome-cell-pulse ${dur}s ease-in-out ${0.4 + delay}s infinite`,
              }}
            />
          );
        })}
      </div>
      <div
        className="absolute inset-0"
        style={{
          background: dark
            ? "radial-gradient(circle at 50% 55%, transparent 0%, rgba(10,15,25,0.55) 70%, rgba(10,15,25,0.85) 100%)"
            : "radial-gradient(circle at 50% 55%, transparent 0%, rgba(248,250,252,0.6) 70%, rgba(248,250,252,0.9) 100%)",
        }}
      />
    </div>
  );
}

const WELCOME_KEYFRAMES = `
@keyframes welcome-grid-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes welcome-cell-pulse {
  0%, 100% { opacity: 0.15; transform: scale(0.9); filter: blur(0.5px); }
  50% { opacity: 0.95; transform: scale(1); filter: blur(0px); }
}
@keyframes welcome-logo-in {
  0% { opacity: 0; transform: scale(2.2); filter: blur(8px); }
  60% { opacity: 1; filter: blur(0px); }
  100% { opacity: 1; transform: scale(1); filter: blur(0px); }
}
@keyframes welcome-slogan-glow {
  0%, 100% { text-shadow: 0 0 6px var(--neon), 0 0 14px var(--neon-soft); }
  50% { text-shadow: 0 0 14px var(--neon), 0 0 28px var(--neon-soft); }
}
@keyframes welcome-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

// ---------------------------------------------------------------------------
// Footer (social row + credit line)
// ---------------------------------------------------------------------------

function WelcomeFooter({ dark }: { dark: boolean }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-2 sm:gap-4">
        {SOCIAL_LINKS.map(({ href, label, Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            aria-label={label}
            className={`rounded-full p-2 transition-colors ${
              dark ? "text-gray-500 hover:bg-gray-800 hover:text-white" : "text-gray-400 hover:bg-gray-200 hover:text-gray-900"
            }`}
          >
            <Icon />
          </a>
        ))}
      </div>
      <p className={`text-center text-xs ${dark ? "text-gray-600" : "text-gray-400"}`}>
        Created with{" "}
        <svg className="-mt-0.5 inline h-3 w-3" viewBox="0 0 24 24" fill="#ef4444" aria-label="love">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>{" "}
        by{" "}
        <a
          href="https://ardacanbakis.com"
          target="_blank"
          rel="noopener noreferrer"
          className={`transition-colors ${dark ? "text-gray-500 hover:text-blue-400" : "text-gray-500 hover:text-blue-600"}`}
        >
          Arda Canbakis
        </a>{" "}
        &copy; 2026
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The welcome screen
// ---------------------------------------------------------------------------

export default function WelcomePage() {
  const router = useRouter();
  const { session, enterDemo, theme, setTheme } = useApp();
  const { t } = useI18n();
  const [step, setStep] = useState<0 | 1>(0);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemDark(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const dark = theme === "system" ? systemDark : theme !== "light";
  const isAuthed = session.status === "ready";

  const neon = dark ? "#22d3ee" : "#3b82f6";
  const neonSoft = dark ? "rgba(34,211,238,0.55)" : "rgba(59,130,246,0.45)";
  const cssVars = { "--neon": neon, "--neon-soft": neonSoft } as React.CSSProperties;
  const gradient = dark
    ? "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)"
    : "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)";

  const bg = dark ? "bg-[#0a0f19]" : "bg-slate-50";
  const text = dark ? "text-white" : "text-gray-900";
  const textFaint = dark ? "text-gray-400" : "text-gray-500";
  const skipColor = dark ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-700";
  const cardBg = dark ? "bg-gray-900/70 border-gray-700/60 backdrop-blur-sm" : "bg-white/80 border-gray-200 shadow-sm backdrop-blur-sm";

  const startDemo = () => {
    enterDemo();
    router.replace("/");
  };

  return (
    <div
      className={`relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-colors duration-500 ${bg}`}
      style={cssVars}
    >
      <style>{WELCOME_KEYFRAMES}</style>
      <NeonGrid dark={dark} />

      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        className={`absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 rounded-full p-2 text-lg transition-colors ${
          dark ? "text-gray-400 hover:bg-white/10 hover:text-yellow-300" : "text-gray-500 hover:bg-black/5 hover:text-orange-600"
        }`}
        aria-label="Toggle theme"
      >
        {dark ? "☀" : "☾"}
      </button>

      <div className="relative z-10 flex w-full max-w-2xl flex-1 items-center justify-center">
        {step === 0 ? (
          <div className="grid w-full max-w-md gap-6 text-center">
            <div className="flex justify-center">
              <div
                className="flex h-24 w-24 items-center justify-center rounded-2xl"
                style={{
                  background: gradient,
                  boxShadow: `0 0 32px ${neonSoft}`,
                  animation: "welcome-logo-in 1.4s cubic-bezier(0.22, 1, 0.36, 1) both",
                }}
              >
                <WalletIcon />
              </div>
            </div>

            <h1 className={`text-4xl font-semibold tracking-tight ${text}`} style={{ animation: "welcome-fade-up 0.7s ease-out 1.4s both" }}>
              BudgetSim
            </h1>

            <p
              className="text-lg font-medium tracking-wide"
              style={{
                color: neon,
                animation: "welcome-fade-up 0.7s ease-out 1.6s both, welcome-slogan-glow 3.2s ease-in-out 2.3s infinite",
              }}
            >
              {t("welcome.slogan")}
            </p>

            <p className={`mx-auto max-w-sm text-sm ${textFaint}`} style={{ animation: "welcome-fade-up 0.7s ease-out 1.9s both" }}>
              {t("welcome.blurb")}
            </p>

            <div className="mt-2 grid gap-3" style={{ animation: "welcome-fade-up 0.7s ease-out 2.2s both" }}>
              {isAuthed ? (
                <button
                  type="button"
                  onClick={() => router.replace("/")}
                  className="rounded-lg px-8 py-3 text-base font-medium text-white transition-all"
                  style={{ background: gradient, boxShadow: `0 0 24px ${neonSoft}` }}
                >
                  {t("welcome.continue")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="mx-auto w-3/4 rounded-lg px-8 py-3 text-base font-medium text-white transition-all hover:scale-105"
                    style={{ background: gradient, boxShadow: `0 0 24px ${neonSoft}` }}
                  >
                    {t("auth.signIn")}
                  </button>
                  <button
                    type="button"
                    onClick={startDemo}
                    className={`mx-auto w-3/4 rounded-lg border px-8 py-3 text-base font-medium transition-transform hover:scale-105 ${
                      dark
                        ? "border-gray-700/60 bg-gray-900/40 text-gray-200 hover:bg-gray-900/70"
                        : "border-gray-200 bg-white/60 text-gray-700 hover:bg-white"
                    }`}
                  >
                    {t("auth.tryDemo")}
                  </button>
                </>
              )}
            </div>

            <div style={{ animation: "welcome-fade-up 0.7s ease-out 2.4s both" }}>
              <button type="button" onClick={() => setStep(1)} className={`inline-flex items-center gap-1.5 text-sm transition-colors ${skipColor}`}>
                {t("welcome.seeWhat")} →
              </button>
            </div>
          </div>
        ) : (
          <div className="grid w-full max-w-2xl gap-5">
            <div className="text-center" style={{ animation: "welcome-fade-up 0.5s ease-out both" }}>
              <h2 className={`text-xl font-semibold ${text}`}>{t("welcome.whatsIn")}</h2>
              <p className={`mt-1 text-sm ${textFaint}`}>{t("welcome.whatsInSub")}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FEATURES.map((f, i) => (
                <div
                  key={f.key}
                  className={`flex gap-3 rounded-lg border p-4 ${cardBg}`}
                  style={{ opacity: 0, animation: `welcome-fade-up 0.5s ease-out ${0.1 + i * 0.08}s both` }}
                >
                  <div className="mt-0.5 shrink-0 text-lg leading-none" style={{ color: neon }}>
                    {f.icon}
                  </div>
                  <div className="text-left">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: neon }}>
                      {t(`welcome.tags.${f.tag}`)}
                    </div>
                    <h3 className={`text-sm font-medium ${dark ? "text-white" : "text-gray-900"}`}>{t(`welcome.features.${f.key}.title`)}</h3>
                    <p className={`mt-1 text-xs leading-relaxed ${dark ? "text-gray-400" : "text-gray-600"}`}>
                      {t(`welcome.features.${f.key}.desc`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-4 pt-2" style={{ opacity: 0, animation: "welcome-fade-up 0.6s ease-out 0.9s both" }}>
              <button type="button" onClick={() => setStep(0)} className={`inline-flex items-center gap-1.5 text-sm transition-colors ${skipColor}`}>
                ← {t("common.close")}
              </button>
              <button
                type="button"
                onClick={() => (isAuthed ? router.replace("/") : startDemo())}
                className="rounded-lg px-8 py-3 text-base font-medium text-white transition-all"
                style={{ background: gradient, boxShadow: `0 0 24px ${neonSoft}` }}
              >
                {isAuthed ? t("welcome.continue") : t("welcome.getStarted")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative z-10 shrink-0 pb-2 pt-6">
        <WelcomeFooter dark={dark} />
      </div>
    </div>
  );
}
