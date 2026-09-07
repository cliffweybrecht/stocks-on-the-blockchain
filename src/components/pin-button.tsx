"use client";

import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
      title={pinned ? "Unpin from this browser" : "Pin in this browser"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <Star className={pinned ? "fill-primary text-primary" : "text-muted-foreground"} />
    </Button>
  );
}
