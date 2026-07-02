"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";
import { useApp } from "@/lib/data/provider";
import { useI18n } from "@/lib/i18n";
import { getSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const { session, enterDemo } = useApp();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === "ready") router.replace("/");
  }, [session.status, router]);

  const supabaseAvailable = session.status !== "signedOut" || session.supabaseAvailable;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = getSupabase();
      if (mode === "signUp") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMessage(t("auth.checkEmail"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-teal-700 dark:text-teal-400">{t("auth.title")}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("auth.subtitle")}</p>
        </div>

        <Card className="p-4">
          {supabaseAvailable ? (
            <form onSubmit={submit} className="space-y-3">
              <Field label={t("auth.email")}>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
              <Field label={t("auth.password")}>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signUp" ? "new-password" : "current-password"}
                />
              </Field>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {mode === "signUp" ? t("auth.signUp") : t("auth.signIn")}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-zinc-500 hover:text-teal-600"
                onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}
              >
                {mode === "signUp" ? t("auth.signInHint") : t("auth.signUpHint")}
              </button>
            </form>
          ) : (
            <p className="text-sm text-amber-600">{t("auth.supabaseMissing")}</p>
          )}
        </Card>

        <Card className="p-4 text-center">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              enterDemo();
              router.replace("/");
            }}
          >
            {t("auth.tryDemo")}
          </Button>
          <p className="mt-2 text-xs text-zinc-400">{t("auth.demoHint")}</p>
        </Card>

        <div className="text-center text-xs text-zinc-400">
          <button className={locale === "en" ? "font-semibold text-teal-600" : ""} onClick={() => setLocale("en")}>
            English
          </button>
          <span className="mx-2">·</span>
          <button className={locale === "tr" ? "font-semibold text-teal-600" : ""} onClick={() => setLocale("tr")}>
            Türkçe
          </button>
        </div>
      </div>
    </main>
  );
}
