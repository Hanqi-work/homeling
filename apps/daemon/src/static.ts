/**
 * Static hosting for the /lite UI, read-only from the web build output (apps/web/dist).
 * Mirrors the useful parts of Collie's serveStatic (server.ts): normalize + boundary-checked
 * path resolution, extension-aware SPA fallback — but never touches the Collie checkout.
 */
import { join, normalize, sep } from "node:path";

export interface StaticDir {
  /** Absolute path of the build output directory (default apps/web/dist). */
  readonly root: string;
  /** SPA entry served for fallback and for the mount root. */
  readonly indexHtml: string;
}

export interface ResolvedStatic {
  /** Path relative to the static root, using the platform separator. */
  readonly rel: string;
  /** Absolute path on disk. */
  readonly full: string;
}

/**
 * Resolve a request path (already stripped of the /lite mount prefix by the caller) to a file
 * under the static root, or null when it escapes it.
 */
export function resolveStaticPath(pathname: string, dir: StaticDir): ResolvedStatic | null {
  let rel = pathname;
  // Strip the mount prefix the caller left on; anything else stays rooted at "/".
  if (rel.startsWith("/lite/")) rel = rel.slice("/lite".length);
  else if (rel === "/lite") rel = "/";
  else if (rel !== "/" && rel !== "" && !rel.startsWith("/assets/")) return null;
  if (rel === "/" || rel === "") rel = `/${dir.indexHtml}`;

  const full = normalize(join(dir.root, rel));
  // The `+ sep` boundary rejects siblings that merely share the prefix (rootX/evil.js).
  if (full !== dir.root && !full.startsWith(dir.root + sep)) return null;
  return { rel: normalize(rel).replace(/^\//, ""), full };
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function contentTypeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serve a /lite request from the build output. A path that escapes the root or hits the
 * filesystem oddly returns a 404 Response; a missing extensionless path falls back to the
 * SPA index so deep links and refreshes work.
 *
 * Returns null when `pathname` is not under this handler's jurisdiction at all.
 */
export async function serveStatic(req: Request, dir: StaticDir): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname !== "/" && pathname !== "/lite" && !pathname.startsWith("/lite/") && !pathname.startsWith("/assets/")) {
    return null;
  }
  const resolved = resolveStaticPath(pathname, dir);
  if (!resolved) return new Response("not found", { status: 404 });

  try {
    const file = Bun.file(resolved.full);
    if (await file.exists()) {
      return new Response(file, {
        headers: { "content-type": contentTypeOf(resolved.full) },
      });
    }
  } catch {
    return new Response("not found", { status: 404 });
  }

  // SPA fallback: only for extensionless paths (deep links). A missing asset keeps its 404.
  const last = resolved.rel.split(sep).pop() ?? "";
  if (last.includes(".")) return new Response("not found", { status: 404 });

  const index = Bun.file(join(dir.root, dir.indexHtml));
  if (!(await index.exists())) return new Response("not found", { status: 404 });
  return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
}
