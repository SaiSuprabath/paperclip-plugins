import { useCallback, useEffect, useRef, useState } from "react";
import { usePluginAction, usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PlanPayload, PortfolioRow } from "../shared/types.js";

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  color: string | null;
  targetDate: string | null;
}

type DataResult<T> = { data: T | null; loading: boolean; error: { message: string } | null; refresh?: () => void | Promise<void> };

export function useProjects(companyId: string | null) {
  return usePluginData<ProjectRow[]>("projects", companyId ? { companyId } : { companyId: "" }) as unknown as DataResult<ProjectRow[]>;
}

export function usePlan(companyId: string | null, projectId: string | null) {
  return usePluginData<PlanPayload>("plan", { companyId: companyId ?? "", projectId: projectId ?? "" }) as unknown as DataResult<PlanPayload>;
}

export function usePortfolio(companyId: string | null) {
  return usePluginData<PortfolioRow[]>("portfolio", { companyId: companyId ?? "" }) as unknown as DataResult<PortfolioRow[]>;
}

export interface Toast {
  id: number;
  message: string;
  kind: "ok" | "err";
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((message: string, kind: Toast["kind"] = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 6000 : 2600);
  }, []);
  return { toasts, push };
}

/** Wraps a plugin action: runs it, reports errors, then refreshes the plan. */
export function useAction(key: string, companyId: string | null, onDone?: () => void, toast?: (m: string, k?: "ok" | "err") => void) {
  const run = usePluginAction(key) as unknown as (params: Record<string, unknown>) => Promise<unknown>;
  const [busy, setBusy] = useState(false);
  const fn = useCallback(
    async (params: Record<string, unknown>, successMessage?: string) => {
      setBusy(true);
      try {
        const res = await run({ companyId, ...params });
        if (successMessage) toast?.(successMessage, "ok");
        onDone?.();
        return res;
      } catch (err) {
        toast?.(err instanceof Error ? err.message : String(err), "err");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [run, companyId, onDone, toast],
  );
  return { fn, busy };
}

/** Debounced value helper for text inputs that save on blur. */
export function useDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}
