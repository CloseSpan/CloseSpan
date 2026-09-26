import { verifyGithubInstallCompletionToken } from "@/lib/github-installation-state";
import { GithubConnectionResult } from "./result";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ receipt?: string | string[] }> }) {
  const parameters = await searchParams;
  let completion = null;
  try {
    if (typeof parameters.receipt === "string") completion = verifyGithubInstallCompletionToken(parameters.receipt);
  } catch { /* Untrusted query parameters never publish a completion result. */ }
  return <GithubConnectionResult completion={completion} />;
}
