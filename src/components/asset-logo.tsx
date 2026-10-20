"use client";

import { useState } from "react";
import { assetMonogram, isHttpLogoUrl } from "@/lib/desk/asset-identity";
import { companyLogoForSymbol, issuerBadgeSrc } from "@/lib/desk/company-logo";

export function AssetLogo({
  logoUrl,
  name,
  symbol,
  issuer = null,
  size = "lg",
}: {
  logoUrl: string | null;
  name: string;
  symbol: string;
  /** Used for the corner issuer badge. The company mark is keyed off `symbol`. */
  issuer?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const company = companyLogoForSymbol(symbol, issuer);
  const fallbackUrl = isHttpLogoUrl(logoUrl) ? logoUrl : null;
  const [companyFailed, setCompanyFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const showCompany = Boolean(company) && !companyFailed;
  const showFallback = !showCompany && Boolean(fallbackUrl) && !fallbackFailed;
  const monogram = assetMonogram(name, symbol);
  const box = size === "sm" ? "size-8" : size === "md" ? "size-10" : "size-14 sm:size-16";
  const px = size === "sm" ? 32 : size === "md" ? 40 : 64;
  const type =
    size === "sm" ? "text-[10px] font-semibold" : size === "md" ? "text-[11px] font-semibold" : "text-sm font-semibold sm:text-base";
  const ring = size === "sm" ? "ring-2 ring-background" : "ring-1 ring-border";
  const plate =
    company?.plate === "white"
      ? "bg-white object-contain p-1"
      : company?.plate === "dark"
        ? "bg-[#141414] object-contain p-0.5"
        : "bg-[#141414] object-cover";
  const badge = showCompany && size !== "sm" ? issuerBadgeSrc(issuer) : null;

  return (
    <div
      className={`relative shrink-0 ${box}`}
      aria-hidden={showCompany || showFallback ? undefined : true}
      data-logo={showCompany ? "company" : showFallback ? "issuer" : "monogram"}
    >
      <div
        className={`flex size-full items-center justify-center rounded-full bg-muted tracking-wide text-foreground ${type} ${ring}`}
      >
        {monogram}
      </div>
      {showCompany && company ? (
        // Local file. A failed load falls through to the issuer icon, then the monogram.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={company.src}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 size-full rounded-full ${plate} ${ring}`}
          onError={() => setCompanyFailed(true)}
        />
      ) : showFallback && fallbackUrl ? (
        // DexScreener / issuer hosts vary; the monogram shows if the file 404s.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fallbackUrl}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 size-full rounded-full bg-card object-cover ${ring}`}
          onError={() => setFallbackFailed(true)}
        />
      ) : null}
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={badge}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-[#0c0c0c] object-cover ring-2 ring-[#141414]"
        />
      ) : null}
      <span className="sr-only">{name}</span>
    </div>
  );
}
