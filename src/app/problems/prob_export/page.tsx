import { AppShell } from "@/components/app-shell";
import { ProblemWorkspace } from "@/components/problem-workspace";
import { getState } from "@/lib/store";
import { ORG_ID } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default function ProblemDetailPage() {
  return <AppShell section="Product problems › FF-142"><ProblemWorkspace initialState={structuredClone(getState(ORG_ID))}/></AppShell>;
}
