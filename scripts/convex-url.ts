/**
 * Which Convex deployment the bundle should talk to.
 *
 * Read at build time by both server.ts and build.ts and baked into the module,
 * because the page cannot read a `.env` file — a browser has no filesystem, and
 * the Tauri build loads from disk with no server in front of it to inject
 * anything.
 *
 * This used to be a constant in src/live.ts, on the reasoning that the URL was
 * the same on every developer's machine. That was true of a self-hosted backend
 * on 127.0.0.1:3210 and is not true of Convex Cloud, where every deployment has
 * its own hostname — so the value has to follow the deployment rather than the
 * checkout.
 *
 * Bun loads `.env.local` into the environment on its own, which is where
 * `convex dev` writes `CONVEX_DEPLOYMENT`. Nothing here needs a build step of
 * its own.
 */

/**
 * `dev:rapid-lemming-123` → `https://rapid-lemming-123.convex.cloud`.
 *
 * The deployment name is the hostname; `convex dev` writes the prefixed form
 * and nothing else, so this is how a project with no framework-specific
 * `*_CONVEX_URL` variable still finds its own backend.
 */
function fromDeployment(value: string): string {
  const name = value.includes(":") ? (value.split(":").pop() ?? "") : value;
  return name ? `https://${name}.convex.cloud` : "";
}

/**
 * The URL, or an empty string when nothing is configured.
 *
 * Empty rather than a thrown error or a guessed default: a checkout with no
 * backend has to keep building, because the seeded demo is the thing that must
 * never depend on Convex being reachable. src/live.ts falls back to loopback,
 * which is also what a self-hosted deployment answers on.
 */
export function convexUrl(): string {
  const env = process.env;

  // Self-hosted wins when it is set, because someone who ran docker compose
  // meant it — see docker-compose.yml for why that choice exists at all.
  const explicit =
    env["CONVEX_SELF_HOSTED_URL"] ||
    env["CONVEX_URL"] ||
    env["VITE_CONVEX_URL"] ||
    env["NEXT_PUBLIC_CONVEX_URL"] ||
    "";
  if (explicit) return explicit.replace(/\/+$/, "");

  const deployment = env["CONVEX_DEPLOYMENT"] ?? "";
  return deployment ? fromDeployment(deployment) : "";
}

/** What both bundlers pass as `define`. One place, so they cannot drift. */
export function convexDefine(): Record<string, string> {
  return { __CONVEX_URL__: JSON.stringify(convexUrl()) };
}

/**
 * What every backend script says when there is no deployment to talk to.
 *
 * Shared because it used to be four copies that all said "is `docker compose
 * up -d` running?" — which is now a wrong guess as often as a right one, and a
 * wrong guess in an error message sends someone down the wrong path entirely.
 */
export const MISSING_CONVEX = `No Convex deployment configured.

  Cloud:       bunx convex dev        (writes CONVEX_DEPLOYMENT to .env.local)
  Self-hosted: docker compose up -d   (then CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210)
`;
