import { z } from "zod";

/** Shareable catalogue page length. The URL carries `page`. */
export const CATALOGUE_PAGE_SIZE = 20;

const PERSONAL_SCENARIO_KEYS = new Set([
  "loan",
  "income",
  "debt",
  "fee",
  "deposit",
  "running-cost",
  "runningcost",
  "emi",
  "principal",
  "interest",
  "tenure",
  "salary",
  "take-home",
  "takehome",
]);

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const canonicalId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/);
const attribute = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9 -]*$/);

export const catalogueListInput = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    brand: slug.optional(),
    model: slug.optional(),
    generation: slug.optional(),
    year: canonicalId.optional(),
    market: canonicalId.optional(),
    body: attribute.optional(),
    powertrain: attribute.optional(),
    transmission: attribute.optional(),
    coverage: z.enum(["applicability", "generation", "model"]).optional(),
    page: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type CatalogueListSelection = z.infer<typeof catalogueListInput>;

export type CatalogueListQuery = CatalogueListSelection & {
  q: string;
  page: number;
};

const FILTER_KEYS = [
  "brand",
  "model",
  "generation",
  "year",
  "market",
  "body",
  "powertrain",
  "transmission",
  "coverage",
] as const;

const KNOWN_KEYS = new Set<string>(["q", "page", ...FILTER_KEYS]);

export function parseCatalogueListQuery(
  raw: Record<string, string | string[] | undefined>,
): { ok: true; query: CatalogueListQuery; href: string } | { ok: false } {
  const candidate: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim().toLowerCase();
    if (PERSONAL_SCENARIO_KEYS.has(normalizedKey) || !KNOWN_KEYS.has(key)) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined) continue;
    const text = first.trim();
    if (!text) continue;
    if (key === "page") {
      if (!/^[1-9][0-9]*$/.test(text)) return { ok: false };
      candidate.page = Number(text);
      continue;
    }
    candidate[key] = text;
  }
  const parsed = catalogueListInput.safeParse(candidate);
  if (!parsed.success) return { ok: false };
  const query: CatalogueListQuery = {
    ...parsed.data,
    q: parsed.data.q ?? "",
    page: parsed.data.page ?? 1,
  };
  return { ok: true, query, href: catalogueListHref(query) };
}

export function catalogueListHref(query: CatalogueListSelection & { q?: string; page?: number }): string {
  const params = new URLSearchParams();
  const q = query.q?.trim() ?? "";
  if (q) params.set("q", q);
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `/cars?${text}` : "/cars";
}

export function catalogueScrollKey(href: string): string {
  return `catalogue-list:${href}`;
}

export function readCatalogueScroll(
  storage: { getItem(key: string): string | null },
  href: string,
): number | null {
  const raw = storage.getItem(catalogueScrollKey(href));
  if (!raw || !/^\d+$/.test(raw)) return null;
  const position = Number(raw);
  return Number.isSafeInteger(position) ? position : null;
}

export function writeCatalogueScroll(
  storage: { setItem(key: string, value: string): void },
  href: string,
  scrollY: number,
): void {
  if (!Number.isFinite(scrollY) || scrollY < 0) return;
  storage.setItem(catalogueScrollKey(href), String(Math.floor(scrollY)));
}

/** A hidden or disabled control cannot take part in the filter sheet's focus trap. */
export function catalogueControlFocusable(control: {
  type?: string | null;
  hidden?: boolean;
  disabled?: boolean;
}): boolean {
  if (control.disabled || control.hidden) return false;
  return control.type !== "hidden";
}

export function nextCatalogueSheetControl(
  controls: readonly { id: string; focusable: boolean }[],
  currentId: string | null,
  shift: boolean,
): string | null {
  return nextCatalogueFocus(
    controls.filter((control) => control.focusable).map((control) => control.id),
    currentId,
    shift,
  );
}

/** Moves keyboard focus inside an open filter sheet, wrapping at either end. */
export function nextCatalogueFocus(
  ids: readonly string[],
  currentId: string | null,
  shift: boolean,
): string | null {
  if (ids.length === 0) return null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index === -1) return shift ? (ids[ids.length - 1] ?? null) : (ids[0] ?? null);
  const next = shift ? (index - 1 + ids.length) % ids.length : (index + 1) % ids.length;
  return ids[next] ?? null;
}
