import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function EmptyState({
  title,
  detail,
  href = "/",
  action = "Back to chains",
}: {
  title: string;
  detail: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">{detail}</p>
      <Link href={href} className={`${buttonVariants()} mt-6 inline-flex`}>
        {action}
      </Link>
    </div>
  );
}
