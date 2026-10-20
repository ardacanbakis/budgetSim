/**
 * The build the app is running, baked in at build time by next.config.ts:
 * the commit, its branch, the PR it came from when there is one, and when it
 * was built. Empty strings when a build couldn't tell (no git, no Vercel).
 */
export const BUILD = {
  commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "",
  branch: process.env.NEXT_PUBLIC_BUILD_BRANCH ?? "",
  pr: process.env.NEXT_PUBLIC_BUILD_PR ?? "",
  repo: process.env.NEXT_PUBLIC_BUILD_REPO ?? "",
  builtAt: process.env.NEXT_PUBLIC_BUILT_AT ?? "",
};

/** The branch a deploy tracks; anything else is a preview. */
export const MAIN_BRANCH = "main";
