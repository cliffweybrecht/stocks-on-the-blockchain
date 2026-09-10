"use client";

import { useState } from "react";
import { assetMonogram, isHttpLogoUrl } from "@/lib/desk/asset-identity";

export function AssetLogo({
  logoUrl,
  name,
  symbol,
  size = "lg",
}: {
  logoUrl: string | null;
  name: string;
  symbol: string;
  size?: "sm" | "lg";
}) {
  const safeUrl = isHttpLogoUrl(logoUrl) ? logoUrl : null;
  const [failed, setFailed] = useState(false);
  const monogram = assetMonogram(name, symbol);
  const showImage = Boolean(safeUrl) && !failed;
  const box = size === "sm" ? "size-8" : "size-14 sm:size-16";
  const type = size === "sm" ? "text-[10px] font-semibold" : "text-sm font-semibold sm:text-base";
  const ring = size === "sm" ? "ring-2 ring-card" : "ring-1 ring-border";

  return (
    <div className={`relative shrink-0 ${box}`} aria-hidden={showImage ? undefined : true}>
      <div
        className={`flex size-full items-center justify-center rounded-full bg-muted tracking-wide text-foreground ${type} ${ring}`}
      >
        {monogram}
      </div>
      {showImage && safeUrl ? (
        // DexScreener / Terminal hosts vary; fallback to the monogram if the file 404s.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeUrl}
          alt=""
          className={`absolute inset-0 size-full rounded-full bg-card object-cover ${ring}`}
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="sr-only">{name}</span>
    </div>
  );
}
