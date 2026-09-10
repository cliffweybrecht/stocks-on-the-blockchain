import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading chain volume">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-36 w-full" />
      <div className="grid gap-4">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading Solana stocks">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-7 w-36 rounded-full" />
      </div>
      <Skeleton className="h-8 w-full max-w-md" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading stock detail">
      <Skeleton className="h-4 w-48" />
      <div className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Skeleton className="size-14 shrink-0 rounded-full sm:size-16" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </div>
          <div className="flex gap-1">
            <Skeleton className="h-7 w-12 rounded-full" />
            <Skeleton className="h-7 w-10 rounded-full" />
            <Skeleton className="h-7 w-12 rounded-full" />
            <Skeleton className="h-7 w-12 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-4 h-9 w-40" />
        <Skeleton className="mt-3 h-[220px] w-full" />
      </div>
      <div className="rounded-xl border border-border bg-card/80 px-4 py-4">
        <Skeleton className="h-6 w-28" />
        <div className="mt-3 grid grid-cols-2 gap-x-6 lg:grid-cols-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    </div>
  );
}
