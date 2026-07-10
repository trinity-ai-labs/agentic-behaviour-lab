/**
 * Static hosting for the dashboard, as middleware around the API app: GET
 * requests outside `/api` are answered from the web dist directory when it
 * exists (with an `index.html` fallback for SPA client-side routes), and fall
 * through to the API app otherwise — so the server is fully usable headless
 * before the dashboard is ever built.
 */
import { FileSystem, HttpApp, HttpPlatform, HttpServerRequest, HttpServerResponse, Path } from "@effect/platform"
import { Effect, Option } from "effect"

/** Percent-decodes a URL path, treating malformed escapes as "no such file". */
const decodePathname = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

export const withStaticDashboard =
  (webDist: string) =>
  (
    httpApp: HttpApp.Default,
  ): HttpApp.Default<never, FileSystem.FileSystem | Path.Path | HttpPlatform.HttpPlatform> =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const pathname = decodePathname(request.url.split("?")[0] ?? "")

      const isApi = pathname !== undefined && (pathname === "/api" || pathname.startsWith("/api/"))
      const isRead = request.method === "GET" || request.method === "HEAD"
      if (pathname === undefined || isApi || !isRead) return yield* httpApp

      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const distRoot = path.resolve(webDist)

      const fileOf = (candidate: string) =>
        fs.stat(candidate).pipe(
          Effect.option,
          Effect.map(Option.filter((info) => info.type === "File")),
        )

      // Resolving against the dist root and requiring the result to stay
      // under it defeats `..` traversal in the request path.
      const resolved = path.resolve(distRoot, pathname.replace(/^\/+/, ""))
      const requested =
        resolved.startsWith(distRoot + path.sep) && Option.isSome(yield* fileOf(resolved))
          ? resolved
          : undefined

      // Unknown extensionless paths are SPA client-side routes: the dashboard
      // router owns them, so they get index.html. When even index.html is
      // missing the dashboard was never built — the API app answers (404).
      const indexHtml = path.join(distRoot, "index.html")
      const file = requested ?? (Option.isSome(yield* fileOf(indexHtml)) ? indexHtml : undefined)
      if (file === undefined) return yield* httpApp

      return yield* HttpServerResponse.file(file).pipe(Effect.catchAll(() => httpApp))
    })
