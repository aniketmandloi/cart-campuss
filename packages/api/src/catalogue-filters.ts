import { z } from "zod";

import { parseAttributeValue, parsePriceWindow } from "./catalogue-scope";

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
const priceBasis = z.string().trim().min(1).max(200);
const sourcedAttribute = z.string().refine((value) => parseAttributeValue(value) !== null);

const PRICE_FIELDS = ["priceMin", "priceMax", "priceCurrency", "priceMarket", "priceBasis", "priceUnknown"] as const;

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
    priceMin: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    priceMax: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    priceCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    priceMarket: canonicalId.optional(),
    priceBasis: priceBasis.optional(),
    priceUnknown: z.enum(["include", "exclude"]).optional(),
    attr: z.array(sourcedAttribute).max(12).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const present = PRICE_FIELDS.filter((key) => value[key] !== undefined);
    if (present.length === 0) return;
    if (present.length !== PRICE_FIELDS.length) {
      context.addIssue({
        code: "custom",
        path: ["priceBasis"],
        message: "A price filter needs bounds, currency, sales market, basis, and unknown handling.",
      });
      return;
    }
    if (value.priceMin !== undefined && value.priceMax !== undefined && value.priceMin > value.priceMax) {
      context.addIssue({
        code: "custom",
        path: ["priceMax"],
        message: "The price minimum cannot exceed the price maximum.",
      });
    }
  });

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

const PRICE_KEYS = new Set<string>(PRICE_FIELDS);
const FEED_KEYS = new Set(["condition", "sellerCountry", "mileageMax", "auctionStatus"]);
const KNOWN_KEYS = new Set<string>(["q", "page", "attr", ...FILTER_KEYS, ...PRICE_KEYS]);

export function parseCatalogueListQuery(
  raw: Record<string, string | string[] | undefined>,
): { ok: true; query: CatalogueListQuery; href: string } | { ok: false; reason: "price" | "invalid" } {
  const candidate: Record<string, string | number | string[]> = {};
  const priceRaw: {
    priceMin?: string;
    priceMax?: string;
    priceCurrency?: string;
    priceMarket?: string;
    priceBasis?: string;
    priceUnknown?: string;
  } = {};
  const attributes: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.trim().toLowerCase();
    if (PERSONAL_SCENARIO_KEYS.has(normalizedKey) || FEED_KEYS.has(key) || !KNOWN_KEYS.has(key)) continue;
    if (key === "attr") {
      const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
      for (const item of values) {
        const text = item.trim().toLowerCase();
        if (!text) continue;
        if (!parseAttributeValue(text)) return { ok: false, reason: "invalid" };
        if (!attributes.includes(text)) attributes.push(text);
      }
      continue;
    }
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined) continue;
    const text = first.trim();
    if (!text) continue;
    if (key === "page") {
      if (!/^[1-9][0-9]*$/.test(text)) return { ok: false, reason: "invalid" };
      candidate.page = Number(text);
      continue;
    }
    if (PRICE_KEYS.has(key)) {
      priceRaw[key as keyof typeof priceRaw] = text;
      continue;
    }
    candidate[key] = text;
  }
  if (Object.keys(priceRaw).length > 0) {
    const window = parsePriceWindow(priceRaw);
    if (!window) return { ok: false, reason: "price" };
    Object.assign(candidate, window);
  }
  if (attributes.length > 0) candidate.attr = attributes;
  const parsed = catalogueListInput.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const query: CatalogueListQuery = {
    ...parsed.data,
    q: parsed.data.q ?? "",
    page: parsed.data.page ?? 1,
  };
  return { ok: true, query, href: catalogueListHref(query) };
}

export function catalogueListRecord(href: string): Record<string, string | string[]> {
  const params = new URL(href, "http://catalogue.local").searchParams;
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key).filter((value) => value.length > 0);
    if (values.length === 0) continue;
    raw[key] = key === "attr" ? values : (values[0] ?? "");
  }
  return raw;
}

export function catalogueListHref(query: CatalogueListSelection & { q?: string; page?: number }): string {
  const params = new URLSearchParams();
  const q = query.q?.trim() ?? "";
  if (q) params.set("q", q);
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  if (query.priceMin !== undefined && query.priceMax !== undefined && query.priceCurrency && query.priceMarket && query.priceBasis && query.priceUnknown) {
    params.set("priceMin", String(query.priceMin));
    params.set("priceMax", String(query.priceMax));
    params.set("priceCurrency", query.priceCurrency);
    params.set("priceMarket", query.priceMarket);
    params.set("priceBasis", query.priceBasis);
    params.set("priceUnknown", query.priceUnknown);
  }
  for (const value of query.attr ?? []) params.append("attr", value);
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
