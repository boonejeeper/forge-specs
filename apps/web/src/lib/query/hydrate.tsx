import {
  dehydrate,
  HydrationBoundary,
  type QueryClient,
} from "@tanstack/react-query";
import * as React from "react";

import { getQueryClient } from "./client";

/**
 * RSC helper: prefetch on the server, then wrap children in a HydrationBoundary
 * so the client picks up the cache without a refetch.
 *
 * Usage in a Server Component:
 *   <Hydrate prefetch={async (qc) => {
 *     await qc.prefetchQuery({ queryKey: queryKeys.projects.list(wsId), queryFn });
 *   }}>
 *     <ClientList />
 *   </Hydrate>
 */
export async function Hydrate({
  prefetch,
  children,
}: {
  prefetch?: (queryClient: QueryClient) => Promise<void> | void;
  children: React.ReactNode;
}) {
  const queryClient = getQueryClient();
  if (prefetch) await prefetch(queryClient);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
