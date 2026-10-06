import { z } from "zod";
import { route } from "@/lib/api";
import { OBJECT_TYPES } from "@/lib/types";
import { buildGovernance } from "@/lib/services/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (req) => {
  const type = z.enum(OBJECT_TYPES).parse(req.nextUrl.searchParams.get("type") ?? "custom_fields");
  return buildGovernance(type);
});
