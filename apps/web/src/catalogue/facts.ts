import type { CatalogueFact } from "@cart-campuss/api/catalogue";

export type FactGroupId = "powertrain" | "size" | "efficiency" | "safety" | "other";

const GROUP_LABELS: Record<FactGroupId, string> = {
  powertrain: "Powertrain",
  size: "Size and weight",
  efficiency: "Efficiency",
  safety: "Safety and features",
  other: "Other sourced facts",
};

export function factGroup(property: string): FactGroupId {
  const name = property.toLowerCase();
  if (/(powertrain|^power$|torque|drivetrain|transmission|engine|acceleration)/.test(name)) {
    return "powertrain";
  }
  if (/(size|weight|length|width|height|wheelbase|kerb|dry|gross)/.test(name)) return "size";
  if (/(efficien|consumption|range|wltp|nedc|arai)/.test(name)) return "efficiency";
  if (/(safety|feature|airbag)/.test(name)) return "safety";
  return "other";
}

export function isSeparateCount(property: string): boolean {
  return /(sale|registration|export)/i.test(property);
}

export function groupFacts(facts: CatalogueFact[]): Array<{ id: FactGroupId; label: string; facts: CatalogueFact[] }> {
  const grouped: Record<FactGroupId, CatalogueFact[]> = {
    powertrain: [],
    size: [],
    efficiency: [],
    safety: [],
    other: [],
  };
  for (const fact of facts) {
    if (isSeparateCount(fact.property)) continue;
    grouped[factGroup(fact.property)].push(fact);
  }
  return (Object.keys(GROUP_LABELS) as FactGroupId[]).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    facts: grouped[id],
  }));
}

export function separateCounts(facts: CatalogueFact[]): CatalogueFact[] {
  return facts.filter((fact) => isSeparateCount(fact.property));
}

const QUICK_SLOTS: Array<{ label: string; match: (property: string) => boolean }> = [
  { label: "Powertrain", match: (property) => property.toLowerCase() === "powertrain" },
  { label: "Power", match: (property) => property.toLowerCase() === "power" },
  { label: "Torque", match: (property) => property.toLowerCase() === "torque" },
  { label: "Drivetrain", match: (property) => property.toLowerCase() === "drivetrain" },
  { label: "Transmission", match: (property) => property.toLowerCase() === "transmission" },
  {
    label: "Acceleration and efficiency",
    match: (property) => /acceleration|efficiency|range/i.test(property),
  },
];

export function quickFactSlots(facts: CatalogueFact[]): Array<{ label: string; facts: CatalogueFact[] }> {
  return QUICK_SLOTS.map((slot) => ({
    label: slot.label,
    facts: facts.filter((fact) => slot.match(fact.property)),
  }));
}
