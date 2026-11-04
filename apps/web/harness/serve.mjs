// Static server for the embed harness. Serves ./ (the harness page) and
// ../dist-lib (the library build) under an optional URL prefix, so the harness
// can be tried from a sub-path:
//   PREFIX=/tools/editor PORT=5199 pnpm --filter @openreel/web harness
// ISOLATE=1 adds COOP/COEP headers (cross-origin isolation).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "../dist-lib");
const port = Number(process.env.PORT ?? 5199);
const prefix = `/${(process.env.PREFIX ?? "").replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function resolveFile(pathname) {
  if (!pathname.startsWith(`${prefix}/`) && pathname !== prefix) return null;
  let rest = pathname.slice(prefix.length) || "/";
  if (rest.endsWith("/")) rest += "index.html";
  const [root, relative] = rest.startsWith("/lib/")
    ? [libDir, rest.slice("/lib/".length)]
    : [here, rest.slice(1)];
  const file = path.resolve(root, decodeURIComponent(relative));
  if (!file.startsWith(root + path.sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const file = resolveFile(pathname);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }
  const headers = {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  };
  if (process.env.ISOLATE === "1") {
    headers["cross-origin-opener-policy"] = "same-origin";
    headers["cross-origin-embedder-policy"] = "require-corp";
  }
  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`Harness: http://localhost:${port}${prefix}/  (library: ${libDir})`);
});
