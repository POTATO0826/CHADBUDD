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
 * Resolve the first of `names` that is set, else derive from CONVEX_DEPLOYMENT.
 *
 * Empty rather than a thrown error or a guessed default: a checkout with no
 * backend has to keep building, because the seeded demo is the thing that must
 * never depend on Convex being reachable. src/live.ts falls back to loopback,
 * which is also what a self-hosted deployment answers on.
 */
function resolve(names: string[]): string {
  const env = process.env;

  for (const name of names) {
    const value = env[name];
    if (value) return value.replace(/\/+$/, "");
  }

  const deployment = env["CONVEX_DEPLOYMENT"] ?? "";
  return deployment ? fromDeployment(deployment) : "";
}

/**
 * Where processes on this machine WRITE. Self-hosted wins.
 *
 * The bridge, seed-load, demo-client and verify-cites all resolve through here,
 * and the bridge is the one that matters: it holds the Telegram socket, so it
 * is the only thing in the system that can put a real client's words into a
 * database. Someone who ran `docker compose up -d` meant those words to stay on
 * their machine — see the header of docker-compose.yml — so a self-hosted URL
 * outranks a cloud one every time, and a cloud deployment configured for
 * sharing cannot silently become the destination for real conversations.
 */
export function convexUrl(): string {
  return resolve([
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_URL",
    "VITE_CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_URL",
  ]);
}

/**
 * Where the bundled page READS. The shared deployment wins.
 *
 * Deliberately the opposite order, and the difference is the whole point: a
 * teammate cloning this repo has no docker backend and no Telegram session, so
 * a page hardwired to whatever this machine happens to run locally shows them
 * nothing. Setting CONVEX_URL to a Convex Cloud deployment points the page at
 * something they can actually reach, while `convexUrl()` above keeps the bridge
 * writing locally.
 *
 * Point both variables at the same URL and the two collapse back into one.
 */
export function browserConvexUrl(): string {
  return resolve([
    "CONVEX_URL",
    "VITE_CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_URL",
    "CONVEX_SELF_HOSTED_URL",
  ]);
}

/** What both bundlers pass as `define`. One place, so they cannot drift. */
export function convexDefine(): Record<string, string> {
  return { __CONVEX_URL__: JSON.stringify(browserConvexUrl()) };
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
