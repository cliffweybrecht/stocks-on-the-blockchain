export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <h2 className="font-heading text-lg font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
