import { route } from "@/lib/api";
import { listDataTypes } from "@/lib/adapters/server/custom-fields";
import { newContext } from "@/lib/adapters/server/types";
import { toErrorInfo } from "@/lib/procore/errors";
import { clientFor, getInstance } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

/** Tipos de dato / variantes válidos para custom fields en una instancia. */
export const GET = route(async (req) => {
  const inst = await getInstance(req.nextUrl.searchParams.get("instanceId") ?? "");
  try {
    return { dataTypes: await listDataTypes(newContext(clientFor(inst))) };
  } catch (e) {
    return { dataTypes: [], error: toErrorInfo(e).message };
  }
});
