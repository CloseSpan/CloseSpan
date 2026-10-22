import { redirect } from "next/navigation";

// Customer follow-up now lives on each issue page; keep old links working.
export default function Page() {
  redirect("/problems");
}
