/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentData from "../agentData.js";
import type * as calendar from "../calendar.js";
import type * as calls from "../calls.js";
import type * as chats from "../chats.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailIngest from "../emailIngest.js";
import type * as emotions from "../emotions.js";
import type * as holdings from "../holdings.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as news from "../news.js";
import type * as outbox from "../outbox.js";
import type * as presenceLive from "../presenceLive.js";
import type * as scheduling from "../scheduling.js";
import type * as seed from "../seed.js";
import type * as tasks from "../tasks.js";
import type * as threads from "../threads.js";
import type * as verbatim from "../verbatim.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentData: typeof agentData;
  calendar: typeof calendar;
  calls: typeof calls;
  chats: typeof chats;
  crons: typeof crons;
  email: typeof email;
  emailIngest: typeof emailIngest;
  emotions: typeof emotions;
  holdings: typeof holdings;
  http: typeof http;
  ingest: typeof ingest;
  news: typeof news;
  outbox: typeof outbox;
  presenceLive: typeof presenceLive;
  scheduling: typeof scheduling;
  seed: typeof seed;
  tasks: typeof tasks;
  threads: typeof threads;
  verbatim: typeof verbatim;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
