import { route } from "@/lib/api";
import { getRun, runItemsFor } from "@/lib/services/engine";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const run = await getRun(params.id);
  return { run, items: await runItemsFor(params.id) };
});
