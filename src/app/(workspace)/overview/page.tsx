import { redirect } from "next/navigation";

// Issues is the workspace home; the counts dashboard was retired.
export default function OverviewPage() {
  redirect("/problems");
}
