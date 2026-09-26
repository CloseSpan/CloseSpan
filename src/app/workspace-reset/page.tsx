import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { signOutCurrentUser } from "@/app/auth-actions";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { workspaceUiResetEnabled } from "@/lib/workspace-ui-reset";
import styles from "./workspace-reset.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace reset", robots: { index: false, follow: false } };

export default async function WorkspaceResetPage() {
  const host = (await headers()).get("host") ?? "";
  let hostname = "";
  try { hostname = new URL(`http://${host}`).hostname; } catch { /* Invalid hosts fail closed. */ }
  if (!workspaceUiResetEnabled(hostname)) notFound();
  await requireWorkspaceUser();

  return (
    <div className={styles.page} data-gooey="off">
      <header className={styles.header}>
        <span className={styles.brand}>CloseSpan</span>
        <form action={signOutCurrentUser}>
          <button className={styles.signOut} type="submit">Sign out</button>
        </form>
      </header>
      <main className={styles.main}>
        <h1>Workspace reset</h1>
        <p>The previous screens are hidden while we define the customer-success MVP.</p>
        <p className={styles.note}>Your data and integrations are preserved.</p>
      </main>
    </div>
  );
}
