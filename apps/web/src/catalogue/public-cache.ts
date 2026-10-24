import { QueryClient } from "@tanstack/react-query";

/**
 * Shortlist and compare must call the catalogue procedures again.
 * This cache is memory-only and drops a subject when that read returns nothing.
 */
export const publicProjectionQueryOptions = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  refetchOnWindowFocus: "always" as const,
};

const PRIVATE_FIELD = /^(privatePayload|contractText|takedownObligation|deletionObligation|derivativeRestriction|aggregationRestriction)$/;

export function publicProjectionKey(subjectId: string) {
  return ["public-projection", subjectId] as const;
}

export function stripPrivateProjection<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (PRIVATE_FIELD.test(key) ? undefined : item)),
  ) as T;
}

export function rememberPublicProjection(client: QueryClient, subjectId: string, value: unknown) {
  client.setQueryData(publicProjectionKey(subjectId), stripPrivateProjection(value));
}

export function readRememberedProjection(client: QueryClient, subjectId: string) {
  return client.getQueryData(publicProjectionKey(subjectId));
}

export function applyPublicProjectionRead(client: QueryClient, subjectId: string, value: unknown | null) {
  if (value === null) {
    client.removeQueries({ queryKey: publicProjectionKey(subjectId) });
    return;
  }
  rememberPublicProjection(client, subjectId, value);
}
