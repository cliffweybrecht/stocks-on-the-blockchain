"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CoverageBadge } from "@/components/coverage-badge";
import { Button } from "@/components/ui/button";
import { useSolanaFavorites } from "@/components/use-solana-favorites";
import { assetRouteKey } from "@/lib/market/identity";
import { rankSearchHits } from "@/lib/market/asset-search";
import { formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary } from "@/lib/market/types";

export function SolanaJumpSearch({
  chainId,
  assets,
}: {
  chainId: string;
  assets: readonly AssetSummary[];
}) {
  const router = useRouter();
  const dialogId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { favoriteSet } = useSolanaFavorites();

  const hits = useMemo(() => {
    const ranked = rankSearchHits(assets, query, 10);
    if (ranked.length > 0) return ranked;
    if (query.trim()) return [];
    return assets.filter((asset) => favoriteSet.has(asset.contractAddress)).slice(0, 8);
  }, [assets, query, favoriteSet]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const openDialog = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const go = useCallback(
    (asset: AssetSummary) => {
      router.push(`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, assets))}`);
      close();
    },
    [assets, chainId, close, router],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        setQuery("");
        setActive(0);
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing) {
        event.preventDefault();
        setOpen(true);
        setQuery("");
        setActive(0);
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog} className="gap-2">
        <Search />
        Jump
        <kbd className="hidden rounded border border-border px-1 font-mono text-[10px] text-muted-foreground sm:inline">
          /
        </kbd>
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-4 pt-[12vh] backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          >
            <div className="border-b border-border px-3 py-2">
              <p id={dialogId} className="sr-only">
                Jump to a Solana stock
              </p>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Symbol, name, issuer, or mint"
                aria-autocomplete="list"
                aria-controls={`${dialogId}-list`}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(index - 1, 0));
                  } else if (event.key === "Enter") {
                    const hit = hits[active];
                    if (hit) {
                      event.preventDefault();
                      go(hit);
                    }
                  }
                }}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {query.trim()
                  ? "Enter opens the asset. Pins and coverage stay mint-specific."
                  : "Pinned names in this browser, or start typing. Esc closes."}
              </p>
            </div>
            <ul id={`${dialogId}-list`} role="listbox" className="max-h-80 overflow-auto py-1">
              {hits.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {query.trim()
                    ? "No classified Solana name matches that search."
                    : "Pin a name on the chain page, or type a symbol / mint."}
                </li>
              ) : (
                hits.map((asset, index) => (
                  <li key={asset.contractAddress} role="option" aria-selected={index === active}>
                    <button
                      type="button"
                      className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${
                        index === active ? "bg-accent" : "hover:bg-muted/60"
                      }`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(asset)}
                    >
                      <span>
                        <span className="font-medium">{asset.symbol}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {asset.name}
                          {asset.issuer ? ` · ${asset.issuer}` : ""}
                          {asset.instrumentKind === "etf" ? " · ETF" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {asset.volumeCoverage ? <CoverageBadge coverage={asset.volumeCoverage} /> : null}
                        <span className="num text-xs text-muted-foreground">
                          {formatUsdCompact(asset.volume24hUsd ?? null)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
