import { formatDurationMs, formatRelativeTime } from "@/lib/market/format";
import type { DataProvenance } from "@/lib/market/types";

export function ProvenanceBar({ provenance }: { provenance: DataProvenance }) {
  return (
    <section className="rounded-xl border border-border bg-card/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Source <strong className="text-foreground">{provenance.sourceLabel}</strong>
        </span>
        <span>
          Snapshot {formatRelativeTime(provenance.generatedAt ?? provenance.fetchedAt)}
        </span>
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
