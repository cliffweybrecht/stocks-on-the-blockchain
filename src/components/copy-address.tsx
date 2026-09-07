"use client";

import { useState } from "react";
import { formatAddress } from "@/lib/market/format";

export function CopyAddress({ address }: { address: string }) {
  const [status, setStatus] = useState<"idle" | "copied">("idle");

  function onCopy() {
    setStatus("copied");
    void navigator.clipboard?.writeText(address).catch(() => undefined);
    window.setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="num rounded-md bg-muted px-2 py-1 text-xs break-all">{address}</code>
      <button
        type="button"
        onClick={onCopy}
        onPointerUp={onCopy}
        className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm hover:bg-muted"
      >
        {status === "copied" ? "Copied" : `Copy ${formatAddress(address)}`}
      </button>
    </div>
  );
}
