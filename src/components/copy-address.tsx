"use client";

import { Check, Copy } from "lucide-react";
import { useState, type MouseEvent, type PointerEvent } from "react";
import { formatAddress } from "@/lib/market/format";

export function CopyAddressIcon({
  address,
  className = "",
}: {
  address: string;
  className?: string;
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
      <span className="num max-w-[4.5rem] truncate">{formatAddress(address)}</span>
      {status === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function CopyAddress({ address, compact = false }: { address: string; compact?: boolean }) {
  const [status, setStatus] = useState<"idle" | "copied">("idle");

  function onCopy() {
    setStatus("copied");
    void navigator.clipboard?.writeText(address).catch(() => undefined);
    window.setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : ""}`}>
      <code className={`num rounded-md bg-muted px-2 py-1 text-xs ${compact ? "max-w-full truncate sm:max-w-none" : "break-all"}`}>
        {compact ? formatAddress(address) : address}
      </code>
      <button
        type="button"
        onClick={onCopy}
        onPointerUp={onCopy}
        className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm hover:bg-muted"
      >
        {status === "copied" ? "Copied" : compact ? "Copy mint" : `Copy ${formatAddress(address)}`}
      </button>
    </div>
  );
}
