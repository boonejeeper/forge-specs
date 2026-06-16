import { LoadingState } from "@/components/states";

/** Default loading UI for in-app route segments (Suspense fallback). */
export default function AppLoading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <LoadingState />
    </div>
  );
}
