import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function ErrorState({
  title = "Market data is unavailable",
  detail,
  retryHref = "/",
}: {
  title?: string;
  detail: string;
  retryHref?: string;
}) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-10 text-center">
      <h2 className="font-heading text-lg font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{detail}</p>
      <Link href={retryHref} className={`${buttonVariants()} mt-5 inline-flex`}>
        Back to chains
      </Link>
    </div>
  );
}
