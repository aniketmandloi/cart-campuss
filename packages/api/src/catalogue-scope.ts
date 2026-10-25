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
  property: string;
  standard: string;
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
  mode: "directory" | "no-data" | "approved-feed";
  providerCoverage: string | null;
};

export type CataloguePerformanceControl = {
  property: string;
  standard: string;
  value: string;
  label: string;
  count: number;
  current: boolean;
};

export type FeedInventoryFilter = {
  condition?: string;
  sellerCountry?: string;
  mileageMax?: string;
  auctionStatus?: string;
  providerCoverage: string;
};

/** The public list has no approved-feed coverage statement, so it stays a directory. */
export const DIRECTORY_CATALOGUE_ACCESS: CatalogueMarketAccess = {
  mode: "directory",
  providerCoverage: null,
};

const PRICE_BASIS = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}$/;
const CANONICAL_ID = /^[a-z0-9_-]{1,80}$/;
const ATTRIBUTE_TOKEN = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const NUMERIC_VALUE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CATEGORICAL_PROPERTIES = new Set(["body", "powertrain", "transmission"]);

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
  if (!CANONICAL_ID.test(priceMarket) || !PRICE_BASIS.test(priceBasis)) return null;
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

export function parseAttributeValue(value: string): { property: string; standard: string } | null {
  const [property, standard, extra] = value.split(":");
  if (!property || !standard || extra !== undefined) return null;
  if (!ATTRIBUTE_TOKEN.test(property) || !ATTRIBUTE_TOKEN.test(standard)) return null;
  return { property, standard };
}

type RawMeasurement = {
  property: string;
  state: string;
  normalizedValue: string | null;
  standard?: string | null;
  measurementStandard?: string | null;
  curated?: boolean;
};

/** Curated numeric facts with a measurement standard. Conflicts and unknown standards stay out. */
export function curatedMeasurements(facts: readonly RawMeasurement[]): ScopedMeasurement[] {
  const seen = new Set<string>();
  const measurements: ScopedMeasurement[] = [];
  for (const fact of facts) {
    if (fact.curated === false || fact.state !== "known") continue;
    const property = fact.property.trim().toLowerCase();
    const standard = (fact.standard ?? fact.measurementStandard ?? "").trim().toLowerCase();
    const normalizedValue = fact.normalizedValue?.trim() ?? "";
    if (!property || !standard || CATEGORICAL_PROPERTIES.has(property)) continue;
    if (!ATTRIBUTE_TOKEN.test(property) || !ATTRIBUTE_TOKEN.test(standard)) continue;
    if (!NUMERIC_VALUE.test(normalizedValue)) continue;
    const key = `${property}:${standard}`;
    if (seen.has(key)) continue;
    seen.add(key);
    measurements.push({ property, standard, normalizedValue });
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
  const counts = new Map<string, { property: string; standard: string; count: number }>();
  for (const record of records) {
    const seen = new Set<string>();
    for (const measurement of record.measurements) {
      const value = `${measurement.property}:${measurement.standard}`;
      if (seen.has(value)) continue;
      seen.add(value);
      const existing = counts.get(value);
      if (existing) existing.count += 1;
      else counts.set(value, { property: measurement.property, standard: measurement.standard, count: 1 });
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
        label: `${item.property} (${item.standard})`,
        count: item.count,
        current: selected.includes(value),
      };
    });
}

const FEED_CONDITION = /^(?:new|used)$/;
const FEED_STATUS = /^(?:active|ended|unknown)$/;
const FEED_MILEAGE = /^(?:0|[1-9]\d*)$/;

/**
 * Feed parameters are inventory filters only for an approved feed that states
 * its provider coverage. Directory and no-data modes, and a feed without that
 * statement, do not honor them.
 */
export function feedInventoryHonored(
  access: CatalogueMarketAccess,
  raw: {
    condition?: string;
    sellerCountry?: string;
    mileageMax?: string;
    auctionStatus?: string;
  },
): FeedInventoryFilter | null {
  const providerCoverage = access.providerCoverage?.trim() ?? "";
  if (access.mode !== "approved-feed" || providerCoverage.length === 0) return null;
  const filter: FeedInventoryFilter = { providerCoverage };
  if (raw.condition !== undefined) {
    if (!FEED_CONDITION.test(raw.condition)) return null;
    filter.condition = raw.condition;
  }
  if (raw.sellerCountry !== undefined) {
    if (!/^[A-Z]{2}$/.test(raw.sellerCountry)) return null;
    filter.sellerCountry = raw.sellerCountry;
  }
  if (raw.mileageMax !== undefined) {
    if (!FEED_MILEAGE.test(raw.mileageMax)) return null;
    filter.mileageMax = raw.mileageMax;
  }
  if (raw.auctionStatus !== undefined) {
    if (!FEED_STATUS.test(raw.auctionStatus)) return null;
    filter.auctionStatus = raw.auctionStatus;
  }
  return filter;
}
