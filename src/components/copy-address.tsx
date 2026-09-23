"use client";

import { Check, Copy } from "lucide-react";
import { useState, type MouseEvent, type PointerEvent } from "react";
import { formatAddress } from "@/lib/market/format";

export function CopyAddressIcon({
  address,
  className = "",
  showAddress = false,
}: {
  address: string;
  className?: string;
  showAddress?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied">("idle");

  function onCopy(event: MouseEvent | PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    setStatus("copied");
    void navigator.clipboard?.writeText(address).catch(() => undefined);
    window.setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      onPointerUp={onCopy}
      title={status === "copied" ? "Copied" : `Copy ${formatAddress(address)}`}
      aria-label={status === "copied" ? "Copied contract address" : `Copy contract address ${formatAddress(address)}`}
      className={`relative z-20 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-neutral-500 hover:bg-white/5 hover:text-neutral-200 ${className}`}
    >
      {showAddress ? <span className="num whitespace-nowrap">{formatAddress(address)}</span> : null}
      {status === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function CopyAddress({
  address,
  compact = false,
  variant,
}: {
  address: string;
  compact?: boolean;
  variant?: "default" | "compact" | "inline";
}) {
  const [status, setStatus] = useState<"idle" | "copied">("idle");
  const mode = variant ?? (compact ? "compact" : "default");

  function onCopy() {
    setStatus("copied");
    void navigator.clipboard?.writeText(address).catch(() => undefined);
    window.setTimeout(() => setStatus("idle"), 2000);
  }

  const copied = status === "copied";
  const label = copied ? "Copied" : mode === "default" ? `Copy ${formatAddress(address)}` : "Copy mint";

  if (mode === "inline") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="num truncate">{formatAddress(address)}</span>
        <button
          type="button"
          onClick={onCopy}
          onPointerUp={onCopy}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
          title={copied ? "Copied" : "Copy mint"}
          aria-label={copied ? "Copied mint" : "Copy mint"}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </span>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${mode === "compact" ? "text-xs" : ""}`}>
      <code
        className={`num rounded-md bg-muted px-2 py-1 text-xs ${mode === "compact" ? "max-w-full truncate sm:max-w-none" : "break-all"}`}
      >
        {mode === "compact" ? formatAddress(address) : address}
      </code>
      <button
        type="button"
        onClick={onCopy}
        onPointerUp={onCopy}
        className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm hover:bg-muted"
      >
        {label}
      </button>
    </div>
  );
}
