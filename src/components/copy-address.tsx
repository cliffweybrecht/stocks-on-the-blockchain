"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatAddress } from "@/lib/market/format";

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="num rounded-md bg-muted px-2 py-1 text-xs break-all">{address}</code>
      <Button type="button" size="sm" variant="outline" onClick={onCopy}>
        {copied ? "Copied" : `Copy ${formatAddress(address)}`}
      </Button>
    </div>
  );
}
