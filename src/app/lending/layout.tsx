import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSectionHidden } from "@/lib/site/visibility";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  if (isSectionHidden("lending")) notFound();
  return {};
}

/** Visibility gate only. Lending rendering stays in the page file. */
export default function LendingLayout({ children }: { children: React.ReactNode }) {
  if (isSectionHidden("lending")) notFound();
  return children;
}
