// menu_categories has zero anon RLS policy (docs/security/rls.md §2.1,
// deliberately deferred to this WBS entry — docs/api/surfaces_design.md §1).
// This function is the one place with service_role credentials that reads
// it, and it does so ONLY for menu_categories: everything else (menu_items,
// menu_option_groups, menu_options) still goes through the anon-key client
// so RLS keeps doing its job on those tables. The service_role read is
// narrowed through toPublicMenuCategory before anything reaches the wire,
// and — because service_role bypasses the anon "non-hidden items only"
// policy that would otherwise apply — this function ALSO must independently
// filter availability <> 'hidden' on the menu_items read below; the anon
// path already gets that for free from RLS, but this function reads
// menu_items too and must not assume the filter happened elsewhere.
import { createPublicClient, createServiceRoleClient } from "../_shared/public/db.ts";
import { jsonResponse, errorResponse, corsPreflightResponse } from "../_shared/public/response.ts";
import {
  toPublicMenuCategory,
  toPublicMenuItem,
  toPublicOptionGroup,
  toPublicOption,
} from "../../../packages/shared/src/serializers/public.ts";
import {
  publicMenuCategorySchema,
  publicMenuItemSchema,
  publicOptionGroupSchema,
  publicOptionSchema,
  parseOrThrow,
} from "../../../packages/shared/src/serializers/public.schema.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(405, "method not allowed");

  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return errorResponse(400, "slug is required");

  const supabase = createPublicClient();

  const { data: store, error: storeErr } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();
  if (storeErr || !store) return errorResponse(404, "store not found");

  const { data: itemRows, error: itemsErr } = await supabase
    .from("menu_items")
    .select("*")
    .eq("store_id", store.id)
    .neq("availability", "hidden")
    .order("sort_order", { ascending: true });
  if (itemsErr) return errorResponse(500, "failed to load menu items");

  const { data: groupRows, error: groupsErr } = await supabase
    .from("menu_option_groups")
    .select("*")
    .eq("store_id", store.id)
    .order("sort_order", { ascending: true });
  if (groupsErr) return errorResponse(500, "failed to load option groups");

  const groupIds = (groupRows ?? []).map((g) => g.id);
  const { data: optionRows, error: optionsErr } = groupIds.length
    ? await supabase
        .from("menu_options")
        .select("*")
        .in("option_group_id", groupIds)
        .order("sort_order", { ascending: true })
    : { data: [], error: null };
  if (optionsErr) return errorResponse(500, "failed to load options");

  const serviceRole = createServiceRoleClient();
  const { data: categoryRows, error: categoriesErr } = await serviceRole
    .from("menu_categories")
    .select("*")
    .eq("store_id", store.id)
    .order("sort_order", { ascending: true });
  if (categoriesErr) return errorResponse(500, "failed to load categories");

  const categories = (categoryRows ?? []).map((row) =>
    parseOrThrow(publicMenuCategorySchema, toPublicMenuCategory(row)),
  );
  const items = (itemRows ?? []).map((row) => parseOrThrow(publicMenuItemSchema, toPublicMenuItem(row)));
  const optionGroups = (groupRows ?? []).map((row) =>
    parseOrThrow(publicOptionGroupSchema, toPublicOptionGroup(row)),
  );
  const options = (optionRows ?? []).map((row) => parseOrThrow(publicOptionSchema, toPublicOption(row)));

  return jsonResponse({ categories, items, optionGroups, options });
});
