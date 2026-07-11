/**
 * The QueryClient singleton. No SSR/hydration boundary in this SPA, so it's
 * created once at module scope — components mount it via QueryClientProvider
 * in src/app.tsx; anything outside the tree (none yet) would import this
 * directly.
 */
import { QueryClient } from "@tanstack/solid-query"

// staleTime/gcTime deliberately absent: every hook spreads a QUERY_TIERS
// preset (src/query/tiers.ts), so a default here would be dead code.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
