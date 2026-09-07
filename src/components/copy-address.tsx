"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { formatAddress } from "@/lib/market/format";

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    setCopied(true);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        const field = document.createElement("textarea");
        field.value = address;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.left = "-9999px";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
    } catch {
      // Clipboard can be locked in some browsers; still show the click confirmation.
    }
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="num rounded-md bg-muted px-2 py-1 text-xs break-all">{address}</code>
      <button type="button" className={buttonVariants({ size: "sm", variant: "outline" })} onClick={onCopy}>
        {copied ? "Copied" : `Copy ${formatAddress(address)}`}
      </button>
    </div>
  );
}
