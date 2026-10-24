/** Visitor catalogue queries are dropped as soon as nothing on screen is reading them. */
export const publicProjectionQueryOptions = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: "always" as const,
  refetchOnReconnect: "always" as const,
  refetchOnWindowFocus: "always" as const,
};
