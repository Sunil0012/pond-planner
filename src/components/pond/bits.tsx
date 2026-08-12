import type { ReactNode } from "react";
import type { Confidence, JobState, RecStatus } from "@/lib/pond/types";

export function StatusPill({ status }: { status: RecStatus }) {
  const map: Record<RecStatus, string> = {
    RECOMMENDED: "bg-success/12 text-success border-success/30",
    CONDITIONAL: "bg-warning/15 text-warning-foreground border-warning/40",
    REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide ${map[status]}`}>{status}</span>;
}

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  return (
    <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground">
      {confidence} CONFIDENCE
    </span>
  );
}

export function JobPill({ state }: { state: JobState }) {
  const map: Record<JobState, string> = {
    CREATED: "text-muted-foreground",
    RUNNING: "text-primary",
    COMPLETED: "text-success",
    NEEDS_REVIEW: "text-warning-foreground",
    FAILED: "text-destructive",
  };
  return <span className={`font-mono text-[10px] tracking-wide ${map[state]}`}>{state}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="label-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-right text-xs">{v}</span>
    </div>
  );
}