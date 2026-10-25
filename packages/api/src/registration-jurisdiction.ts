export type RegistrationJurisdiction = {
  id: string;
  name: string;
  kind: "state" | "union-territory";
};

/**
 * Indian states and union territories a visitor can choose as the place they
 * would register a vehicle. The list is not a location lookup.
 */
export const REGISTRATION_JURISDICTIONS: readonly RegistrationJurisdiction[] = [
  { id: "in-ap", name: "Andhra Pradesh", kind: "state" },
  { id: "in-ar", name: "Arunachal Pradesh", kind: "state" },
  { id: "in-as", name: "Assam", kind: "state" },
  { id: "in-br", name: "Bihar", kind: "state" },
  { id: "in-ct", name: "Chhattisgarh", kind: "state" },
  { id: "in-ga", name: "Goa", kind: "state" },
  { id: "in-gj", name: "Gujarat", kind: "state" },
  { id: "in-hr", name: "Haryana", kind: "state" },
  { id: "in-hp", name: "Himachal Pradesh", kind: "state" },
  { id: "in-jh", name: "Jharkhand", kind: "state" },
  { id: "in-ka", name: "Karnataka", kind: "state" },
  { id: "in-kl", name: "Kerala", kind: "state" },
  { id: "in-mp", name: "Madhya Pradesh", kind: "state" },
  { id: "in-mh", name: "Maharashtra", kind: "state" },
  { id: "in-mn", name: "Manipur", kind: "state" },
  { id: "in-ml", name: "Meghalaya", kind: "state" },
  { id: "in-mz", name: "Mizoram", kind: "state" },
  { id: "in-nl", name: "Nagaland", kind: "state" },
  { id: "in-od", name: "Odisha", kind: "state" },
  { id: "in-pb", name: "Punjab", kind: "state" },
  { id: "in-rj", name: "Rajasthan", kind: "state" },
  { id: "in-sk", name: "Sikkim", kind: "state" },
  { id: "in-tn", name: "Tamil Nadu", kind: "state" },
  { id: "in-tg", name: "Telangana", kind: "state" },
  { id: "in-tr", name: "Tripura", kind: "state" },
  { id: "in-up", name: "Uttar Pradesh", kind: "state" },
  { id: "in-ut", name: "Uttarakhand", kind: "state" },
  { id: "in-wb", name: "West Bengal", kind: "state" },
  { id: "in-an", name: "Andaman and Nicobar Islands", kind: "union-territory" },
  { id: "in-ch", name: "Chandigarh", kind: "union-territory" },
  { id: "in-dh", name: "Dadra and Nagar Haveli and Daman and Diu", kind: "union-territory" },
  { id: "in-dl", name: "Delhi", kind: "union-territory" },
  { id: "in-jk", name: "Jammu and Kashmir", kind: "union-territory" },
  { id: "in-la", name: "Ladakh", kind: "union-territory" },
  { id: "in-ld", name: "Lakshadweep", kind: "union-territory" },
  { id: "in-py", name: "Puducherry", kind: "union-territory" },
];

export function registrationJurisdiction(id: string | undefined): RegistrationJurisdiction | null {
  if (!id) return null;
  return REGISTRATION_JURISDICTIONS.find((place) => place.id === id) ?? null;
}
