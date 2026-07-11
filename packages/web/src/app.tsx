import { Route, Router } from "@solidjs/router"
import { QueryClientProvider } from "@tanstack/solid-query"
import type { JSX } from "solid-js"
import { Shell } from "./components/Shell"
import { ThemeProvider } from "./lib/theme"
import { queryClient } from "./query/client"
import { Benchmarks } from "./views/Benchmarks"
import { RunDetail } from "./views/RunDetail"
import { Runs } from "./views/Runs"
import { Scenarios } from "./views/Scenarios"
import { Trial } from "./views/Trial"

// Provider order matters: theme is a leaf (depends on nothing); the query
// client sits above everything that queries; Shell (chrome + nav) lives in
// Router's `root` so it — and the providers wrapping it — survive
// navigation instead of remounting per route. A sibling slice adds an
// "Author" view + its <Route> here at merge time; nothing in this file
// claims that path.
const Root = (props: { children?: JSX.Element }) => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <Shell>{props.children}</Shell>
    </QueryClientProvider>
  </ThemeProvider>
)

export const App = () => (
  <Router root={Root}>
    <Route path="/" component={Benchmarks} />
    <Route path="/runs" component={Runs} />
    <Route path="/runs/:runId" component={RunDetail} />
    <Route path="/trials/:trialId" component={Trial} />
    <Route path="/scenarios" component={Scenarios} />
  </Router>
)
