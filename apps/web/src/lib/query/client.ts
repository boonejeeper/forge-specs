import {
  isServer,
  QueryClient,
  defaultShouldDehydrateQuery,
} from "@tanstack/react-query";

/**
 * QueryClient factory with sane defaults for an RSC + hydration setup.
 *
 * `staleTime` > 0 prevents an immediate refetch on the client for data already
 * dehydrated by the server. `shouldDehydrateQuery` is widened so that pending
 * queries (streamed from RSC) are also dehydrated.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Server: always a fresh client per request (no cross-request leakage).
 * Browser: a singleton so state survives suspense/re-renders.
 */
export function getQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
