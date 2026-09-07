import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VolumeCoverage } from "@/lib/market/types";
import { volumeCoverageLabel } from "@/lib/market/volume-coverage";

export function coverageBadgeClass(coverage: VolumeCoverage): string {
  switch (coverage) {
    case "hydrate_incomplete":
      return "border-amber-400/40 bg-amber-400/10 text-amber-200";
    case "no_indexed_pools":
      return "border-border/80 bg-muted/40 text-muted-foreground";
    case "hydrate_failed":
      return "";
    case "pools_without_volume":
      return "border-border text-muted-foreground";
    case "reported":
      return "";
  }
}

export function coverageBadgeVariant(
  coverage: VolumeCoverage,
): "default" | "secondary" | "outline" | "destructive" {
  switch (coverage) {
    case "reported":
      return "default";
    case "hydrate_failed":
      return "destructive";
    default:
      return "outline";
  }
}

export function CoverageBadge({ coverage, className }: { coverage: VolumeCoverage; className?: string }) {
  return (
    <Badge variant={coverageBadgeVariant(coverage)} className={cn(coverageBadgeClass(coverage), className)}>
      {volumeCoverageLabel(coverage)}
    </Badge>
  );
}
