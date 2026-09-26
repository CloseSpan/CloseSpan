"use server";

import { signIn, signOut } from "@/auth";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  LEGACY_ACTIVE_ORGANIZATION_COOKIE,
} from "@/lib/auth-user";
import { cookies, headers } from "next/headers";
import { isAppHostname } from "@/lib/app-domain-routing";

function safeRedirect(value: FormDataEntryValue | null): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  ) {
    return value;
  }
  return "/overview";
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  await signIn("google", {
    redirectTo: safeRedirect(formData.get("callbackUrl")),
  });
}

export async function signOutCurrentUser(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORGANIZATION_COOKIE);
  cookieStore.delete(LEGACY_ACTIVE_ORGANIZATION_COOKIE);
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const redirectTo = process.env.CLOSESPAN_APP_DOMAIN_ENABLED === "true" && isAppHostname(host)
    ? "/login"
    : "/";
  await signOut({ redirectTo });
}
