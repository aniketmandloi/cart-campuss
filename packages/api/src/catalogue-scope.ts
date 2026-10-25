/**
 * Scoped catalogue narrowing. A PriceReference is comparable only inside one
 * currency, sales market, and basis. A performance fact is comparable only
 * inside one attribute and measurement standard. Nothing here converts PS,
 * bhp, kW, test cycles, or weight bases into each other, and nothing relabels
 * a foreign amount as an India on-road price.
 */

export type ScopedPrice = {
  amountMinor: number;
  currency: string;
  basis: string;
  salesMarketId: string;
};

export type ScopedMeasurement = {
  /** URL identifier for the sourced attribute, such as `kerb-weight`. */
  property: string;
  /** URL identifier for the measurement standard, such as `kerb`. */
  standard: string;
  /** Sourced attribute and standard, unchanged except for surrounding space. */
  label: string;
  normalizedValue: string;
};

export type PriceWindow = {
  priceMin: number;
  priceMax: number;
  priceCurrency: string;
  priceMarket: string;
  priceBasis: string;
  priceUnknown: "include" | "exclude";
};

export type CatalogueMarketAccess = {
  mode: "directory" | "no-data";
};

export type CataloguePerformanceControl = {
  property: string;
  standard: string;
  value: string;
  label: string;
  count: number;
  current: boolean;
};

/** The public list is a directory. Feed parameters are not inventory filters. */
export const DIRECTORY_CATALOGUE_ACCESS: CatalogueMarketAccess = {
  mode: "directory",
};

const CANONICAL_ID = /^[a-z0-9_-]{1,80}$/;
const NUMERIC_VALUE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const POWER_STANDARDS = ["ps", "bhp", "kw"] as const;
const CYCLE_STANDARDS = ["nedc", "wltp", "arai"] as const;
const WEIGHT_STANDARDS = ["dry", "kerb", "gross"] as const;

/** A performance filter exists only for these sourced attributes and standards. A Map ignores inherited names such as constructor. */
const PERFORMANCE_STANDARDS = new Map<string, readonly string[]>([
  ["power", POWER_STANDARDS],
  ["efficiency", CYCLE_STANDARDS],
  ["consumption", CYCLE_STANDARDS],
  ["range", CYCLE_STANDARDS],
  ["weight", WEIGHT_STANDARDS],
  ["dry-weight", ["dry"]],
  ["kerb-weight", ["kerb"]],
  ["gross-weight", ["gross"]],
]);

export function priceReferenceCaption(price: {
  displayAmount: string;
  basis: string;
  salesMarketName: string;
}): string {
  return `${price.displayAmount}, ${price.basis}, ${price.salesMarketName}`;
}

export function priceWindowMatches(prices: readonly ScopedPrice[], window: PriceWindow): boolean {
  const comparable = prices.filter(
    (price) =>
      price.currency === window.priceCurrency &&
      price.salesMarketId === window.priceMarket &&
      price.basis === window.priceBasis,
  );
  if (comparable.length === 0) return prices.length === 0 && window.priceUnknown === "include";
  return comparable.some(
    (price) => price.amountMinor >= window.priceMin && price.amountMinor <= window.priceMax,
  );
}

export function parsePriceWindow(raw: {
  priceMin?: string;
  priceMax?: string;
  priceCurrency?: string;
  priceMarket?: string;
  priceBasis?: string;
  priceUnknown?: string;
}): PriceWindow | null {
  if (
    raw.priceMin === undefined ||
    raw.priceMax === undefined ||
    raw.priceCurrency === undefined ||
    raw.priceMarket === undefined ||
    raw.priceBasis === undefined ||
    raw.priceUnknown === undefined
  ) {
    return null;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(raw.priceMin) || !/^(?:0|[1-9]\d*)$/.test(raw.priceMax)) return null;
  const priceMin = Number(raw.priceMin);
  const priceMax = Number(raw.priceMax);
  if (!Number.isSafeInteger(priceMin) || !Number.isSafeInteger(priceMax) || priceMin > priceMax) return null;
  const priceCurrency = raw.priceCurrency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(priceCurrency)) return null;
  const priceMarket = raw.priceMarket.trim();
  const priceBasis = raw.priceBasis.trim();
  if (!CANONICAL_ID.test(priceMarket) || !publishedPriceBasis(priceBasis)) return null;
  if (raw.priceUnknown !== "include" && raw.priceUnknown !== "exclude") return null;
  return {
    priceMin,
    priceMax,
    priceCurrency,
    priceMarket,
    priceBasis,
    priceUnknown: raw.priceUnknown,
  };
}

/** Publication stores a trimmed basis of 1 to 200 characters. The filter accepts that same basis. */
export function publishedPriceBasis(value: string): boolean {
  const basis = value.trim();
  return basis.length >= 1 && basis.length <= 200;
}

/** Stable URL identifier for a sourced attribute or measurement standard. */
export function catalogueAttributeId(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
  return slug;
}

export function parseAttributeValue(value: string): { property: string; standard: string } | null {
  const [property, standard, extra] = value.split(":");
  if (!property || !standard || extra !== undefined) return null;
  const propertyId = catalogueAttributeId(property);
  const standardId = catalogueAttributeId(standard);
  if (!propertyId || !standardId) return null;
  if (!PERFORMANCE_STANDARDS.get(propertyId)?.includes(standardId)) return null;
  return { property: propertyId, standard: standardId };
}

type RawMeasurement = {
  property: string;
  state: string;
  normalizedValue: string | null;
  standard?: string | null;
  measurementStandard?: string | null;
  curated?: boolean;
};

/** Curated numeric facts whose standard supports a performance filter. Conflicts stay out. */
export function curatedMeasurements(facts: readonly RawMeasurement[]): ScopedMeasurement[] {
  const seen = new Set<string>();
  const measurements: ScopedMeasurement[] = [];
  for (const fact of facts) {
    if (fact.curated === false || fact.state !== "known") continue;
    const propertyName = fact.property.trim();
    const standardName = (fact.standard ?? fact.measurementStandard ?? "").trim();
    const normalizedValue = fact.normalizedValue?.trim() ?? "";
    const parsed = parseAttributeValue(`${catalogueAttributeId(propertyName) ?? ""}:${catalogueAttributeId(standardName) ?? ""}`);
    if (!parsed || !NUMERIC_VALUE.test(normalizedValue)) continue;
    const key = `${parsed.property}:${parsed.standard}`;
    if (seen.has(key)) continue;
    seen.add(key);
    measurements.push({
      property: parsed.property,
      standard: parsed.standard,
      label: `${propertyName} (${standardName})`,
      normalizedValue,
    });
  }
  return measurements;
}

export function matchesAttribute(
  measurements: readonly ScopedMeasurement[],
  attribute: { property: string; standard: string },
): boolean {
  return measurements.some(
    (measurement) => measurement.property === attribute.property && measurement.standard === attribute.standard,
  );
}

export function listPerformanceControls(
  records: readonly { measurements: readonly ScopedMeasurement[] }[],
  selected: readonly string[],
): CataloguePerformanceControl[] {
  const counts = new Map<string, { property: string; standard: string; label: string; count: number }>();
  for (const record of records) {
    const seen = new Set<string>();
    for (const measurement of record.measurements) {
      const value = `${measurement.property}:${measurement.standard}`;
      if (seen.has(value)) continue;
      seen.add(value);
      const existing = counts.get(value);
      if (existing) existing.count += 1;
      else {
        counts.set(value, {
          property: measurement.property,
          standard: measurement.standard,
          label: measurement.label,
          count: 1,
        });
      }
    }
  }
  return [...counts.values()]
    .sort(
      (left, right) =>
        left.property.localeCompare(right.property) || left.standard.localeCompare(right.standard),
    )
    .map((item) => {
      const value = `${item.property}:${item.standard}`;
      return {
        property: item.property,
        standard: item.standard,
        value,
        label: item.label,
        count: item.count,
        current: selected.includes(value),
      };
    });
}
