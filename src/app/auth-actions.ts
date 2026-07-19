"use server";

import { signIn, signOut } from "@/auth";

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
  await signOut({ redirectTo: "/" });
}
