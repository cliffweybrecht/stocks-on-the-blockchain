import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSectionHidden } from "@/lib/site/visibility";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (isSectionHidden("perps")) notFound();
  return {};
}

/** Visibility gate only. Perps rendering stays in the page files. */
export default function PerpsLayout({ children }: { children: React.ReactNode }) {
  if (isSectionHidden("perps")) notFound();
  return children;
}
