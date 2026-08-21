/**
 * The fallback poll.
 *
 * The push webhook is the fast path and this is the correct one. Push channels
 * lapse, a self-hosted deployment on localhost cannot receive a push at all,
 * and Google drops notifications occasionally by design. None of that is
 * recoverable from inside the push handler, so the mirror never depends on a
 * push arriving — it depends on this, and treats every push as an early poll.
 *
 * Five minutes is chosen against the product, not the API: the status-reply
 * grace period is three minutes, so a schedule this system is more than five
 * minutes behind on could tell a client the wrong thing about where the advisor
 * is. Incremental sync makes a no-change poll close to free, so the cost of
 * being early here is small and the cost of being late is a wrong message.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("calendar sync", { minutes: 5 }, internal.calendar.tick, {});

export default crons;
