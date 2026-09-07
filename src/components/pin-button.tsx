"use client";

import { Star } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function PinButton({
  pinned,
  onToggle,
  label,
}: {
  pinned: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
      data-testid={`solana-pin-${label}`}
      title={pinned ? "Unpin from this browser" : "Pin in this browser"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <Star className={pinned ? "fill-primary text-primary" : "text-muted-foreground"} />
    </button>
  );
}
