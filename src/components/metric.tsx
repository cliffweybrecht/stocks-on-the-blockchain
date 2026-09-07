import { Badge } from "@/components/ui/badge";
import { FACT_LABEL, INTERPRETIVE_LABEL } from "@/lib/market/trust";
import type { TrustKind } from "@/lib/market/types";

export function Metric({
  label,
  value,
  hint,
  trust = "fact",
}: {
  label: string;
  value: string;
  hint?: string;
  trust?: TrustKind;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
        <Badge variant="outline" className={trust === "interpretive" ? "border-interpretive/40 text-interpretive" : ""}>
          {trust === "interpretive" ? INTERPRETIVE_LABEL : FACT_LABEL}
        </Badge>
      </div>
      <p className="num mt-2 text-2xl font-medium tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
