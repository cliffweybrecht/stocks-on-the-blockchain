"use client";

import { useState } from "react";
import { assetMonogram, isHttpLogoUrl } from "@/lib/desk/asset-identity";

export function AssetLogo({
  logoUrl,
  name,
  symbol,
}: {
  logoUrl: string | null;
  name: string;
  symbol: string;
}) {
  const safeUrl = isHttpLogoUrl(logoUrl) ? logoUrl : null;
  const [failed, setFailed] = useState(false);
  const monogram = assetMonogram(name, symbol);
  const showImage = Boolean(safeUrl) && !failed;

  return (
    <div className="relative size-14 shrink-0 sm:size-16" aria-hidden={showImage ? undefined : true}>
      <div className="flex size-full items-center justify-center rounded-full bg-muted text-sm font-semibold tracking-wide text-foreground ring-1 ring-border sm:text-base">
        {monogram}
      </div>
      {showImage && safeUrl ? (
        // DexScreener / Terminal hosts vary; fallback to the monogram if the file 404s.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeUrl}
          alt=""
          className="absolute inset-0 size-full rounded-full bg-card object-cover ring-1 ring-border"
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="sr-only">{name}</span>
    </div>
  );
}
