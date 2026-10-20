import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Which build this is, for the About line at the foot of Settings. Vercel
 * hands its builds the commit, branch and message; a local build asks git.
 * The PR number comes from the merge commit's message ("Merge pull request
 * #36 from …") on main, or from Vercel on a preview of an open PR.
 */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const commit = process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse HEAD");
const message = process.env.VERCEL_GIT_COMMIT_MESSAGE || git("log -1 --format=%s");
const branch = process.env.VERCEL_GIT_COMMIT_REF || git("rev-parse --abbrev-ref HEAD");
const pr = /Merge pull request #(\d+)/.exec(message)?.[1] || process.env.VERCEL_GIT_PULL_REQUEST_ID || "";
const repo =
  process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: commit,
    NEXT_PUBLIC_BUILD_BRANCH: branch,
    NEXT_PUBLIC_BUILD_PR: pr,
    NEXT_PUBLIC_BUILD_REPO: repo,
    NEXT_PUBLIC_BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;
