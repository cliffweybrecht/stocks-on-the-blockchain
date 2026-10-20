import { buildPerpsCsv, PERPS_CSV_FILES, type PerpsCsvId } from "@/lib/market/perps-csv";
import { buildPerpsJson, PERPS_JSON_FILES, type PerpsJsonId } from "@/lib/market/perps-json";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...PERPS_CSV_FILES.map((file) => ({ file: `${file.id}.csv` })),
    ...PERPS_JSON_FILES.map((file) => ({ file: `${file.id}.json` })),
  ];
}

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const model = await loadPerpsDeskModel();
  const csv = PERPS_CSV_FILES.find((row) => `${row.id}.csv` === file);
  if (csv) {
    const body = buildPerpsCsv(csv.id as PerpsCsvId, model);
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${csv.filename}"`,
      },
    });
  }
  const json = PERPS_JSON_FILES.find((row) => `${row.id}.json` === file);
  if (!json) return new Response("Not found", { status: 404 });
  const body = buildPerpsJson(json.id as PerpsJsonId, model, new Date().toISOString());
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${json.filename}"`,
    },
  });
}
