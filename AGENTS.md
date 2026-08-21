<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Who the user is

The target user is an **investment-led advisor** — relationship manager /
financial analyst — whose real product is service and personalisation on top of
the products: portfolio updates, maturity conversations, market context mapped
to individual holdings. Insurance is supported but investments are what the
demo leads with; when adding features or seed data, prefer investment framing.

Assume a book in the **hundreds of clients**. Every list must be a ranked,
capped queue with counts — never one row per client.
