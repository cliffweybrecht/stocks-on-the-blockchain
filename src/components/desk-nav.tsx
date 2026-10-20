"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Spot", match: (path: string) => path === "/" || path.startsWith("/chains") },
  { href: "/perps", label: "Perps", match: (path: string) => path.startsWith("/perps") },
  { href: "/lending", label: "Lending", match: (path: string) => path.startsWith("/lending") },
] as const;

/** Desk switch. Perps and lending stay off the tokenized-stock spot totals. */
export function DeskNav() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Desk" className="flex items-center gap-1" data-desk-nav>
      {LINKS.map((link) => {
        const active = link.match(path);
        return (
          <Link
            key={link.href}
            href={link.href}
            data-desk-link={link.label.toLowerCase()}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
