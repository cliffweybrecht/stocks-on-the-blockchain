import { buildPerpsCsv, PERPS_CSV_FILES, type PerpsCsvId } from "@/lib/market/perps-csv";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return PERPS_CSV_FILES.map((file) => ({ file: `${file.id}.csv` }));
}

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const match = PERPS_CSV_FILES.find((row) => `${row.id}.csv` === file);
  if (!match) {
    return new Response("Not found", { status: 404 });
  }
  const model = await loadPerpsDeskModel();
  const body = buildPerpsCsv(match.id as PerpsCsvId, model);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${match.filename}"`,
    },
  });
}
