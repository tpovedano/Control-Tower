import { route } from "@/lib/api";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { extractList } from "@/lib/procore/client";
import { toErrorInfo } from "@/lib/procore/errors";
import { audit } from "@/lib/services/audit";
import { clientFor, getInstance, recordTest } from "@/lib/services/instances";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Prueba de conexión: token + company visible + permisos de lectura por herramienta. */
export const POST = route<{ id: string }>(async (_req, { user, params }) => {
  const inst = await getInstance(params.id);
  const client = clientFor(inst);
  let companyName: string | null = null;
  try {
    const res = await client.get<unknown>(E.companies(), { companyHeader: false, resource: "Companies", query: { per_page: 100 } });
    const list = extractList<{ id: number | string; name?: string }>(res.data);
    const company = list.find((c) => String(c.id) === inst.companyId);
    if (!company) {
      const msg = `Token válido, pero la company ${inst.companyId} no es visible para esta credencial. Verifica el company_id o los permisos de la service account.`;
      await recordTest(inst.id, false, msg);
      return { ok: false, message: msg, checks: [] };
    }
    companyName = company.name ?? null;
  } catch (e) {
    const info = toErrorInfo(e);
    await recordTest(inst.id, false, info.message);
    await audit({ user, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "TEST", result: "error", httpStatus: info.status, message: info.message });
    return { ok: false, message: info.message, procoreMessage: info.procoreMessage, checks: [] };
  }

  const probes: [string, string][] = [
    ["Custom Fields", E.customFields.list(inst.companyId)],
    ["Field Sets", E.fieldSets.list(inst.companyId)],
    ["Inspection Types", E.inspectionTypes.list(inst.companyId)],
    ["Observation Types", E.observationTypes.listCompany(inst.companyId)],
  ];
  const checks = await Promise.all(
    probes.map(async ([label, path]) => {
      try {
        await client.get(path, { query: { page: 1, per_page: 1 }, resource: label });
        return { label, ok: true, message: "Acceso de lectura correcto" };
      } catch (e) {
        const info = toErrorInfo(e);
        return { label, ok: false, message: info.message, status: info.status };
      }
    }),
  );
  const allOk = checks.every((c) => c.ok);
  const message = allOk ? `Conectado a “${companyName}”.` : `Conectado a “${companyName}”, con permisos incompletos: ${checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}.`;
  await recordTest(inst.id, allOk, message, companyName);
  await audit({ user, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "TEST", result: allOk ? "success" : "error", message });
  return { ok: allOk, message, companyName, checks };
});
