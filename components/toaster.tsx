"use client";

import { useI18n } from "@/lib/i18n";
import { dismissToast, useErrorToasts } from "@/lib/ui/toasts";

/**
 * Failed saves and loads, at the top of the screen and above any open form,
 * so the form stays open with what you typed while the toast says why.
 */
export function Toaster() {
  const { t } = useI18n();
  const toasts = useErrorToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t(toast.action === "save" ? "errors.saveFailed" : "errors.loadFailed")}</p>
            <p className="mt-0.5">{t(`errors.${toast.kind}`)}</p>
            {/* the raw reason only where the plain one can't be specific */}
            {toast.kind === "unknown" || toast.kind === "rejected" ? (
              <p className="mt-1 break-words text-xs opacity-75">{toast.detail}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label={t("errors.dismiss")}
            className="rounded-md p-1 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
