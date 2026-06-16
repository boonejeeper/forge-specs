import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth";
import { getInbox } from "@/lib/data/collaboration";
import { Hydrate } from "@/lib/query/hydrate";
import { queryKeys } from "@/lib/query/keys";
import { Inbox } from "@/features/collaboration/inbox";

/**
 * Notification inbox page. Server-seeds the inbox query cache for the current
 * user, then the client `Inbox` consumes the SSE stream for live updates.
 */
export default async function InboxPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  return (
    <Hydrate
      prefetch={async (qc) => {
        await qc.prefetchQuery({
          queryKey: queryKeys.notifications.inbox(userId),
          queryFn: () => getInbox(userId),
        });
      }}
    >
      <Inbox userId={userId} />
    </Hydrate>
  );
}
