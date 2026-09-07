import { formatDurationMs, formatRelativeTime } from "@/lib/market/format";
import type { DataProvenance } from "@/lib/market/types";

export function ProvenanceBar({
  provenance,
  compact = false,
}: {
  provenance: DataProvenance;
  compact?: boolean;
}) {
  const when = formatRelativeTime(provenance.generatedAt ?? provenance.fetchedAt);

  if (compact) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          <span>{provenance.sourceLabel}</span>
          <span className="px-1.5">·</span>
          <span>{when}</span>
          {provenance.cacheStatus ? (
            <>
              <span className="px-1.5">·</span>
              <span>{provenance.cacheStatus}</span>
            </>
          ) : null}
        </p>
        {provenance.sourceFailures.length > 0 ? (
          <p className="text-xs text-destructive">
            {provenance.sourceFailures
              .map((failure) => `${failure.sourceLabel} unavailable`)
              .join(" · ")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Source <strong className="text-foreground">{provenance.sourceLabel}</strong>
        </span>
        <span>Snapshot {when}</span>
        <span>Fetched {formatRelativeTime(provenance.fetchedAt)}</span>
        {provenance.cacheStatus ? <span>Cache {provenance.cacheStatus}</span> : null}
        {provenance.refreshDurationMs !== null ? (
          <span>Build {formatDurationMs(provenance.refreshDurationMs)}</span>
        ) : null}
      </div>
      {provenance.notes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {provenance.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {provenance.sourceFailures.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-destructive">
          {provenance.sourceFailures.map((failure) => (
            <li key={`${failure.sourceId}:${failure.message}`}>
              {failure.sourceLabel} unavailable: {failure.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
