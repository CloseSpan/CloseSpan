import { normalizeMembershipEmail } from "./organization-repository";
import { PUBLIC_EMAILS } from "./site";

export const PRIVATE_BETA_OWNER_EMAIL = "shanmukhsain@gmail.com";

export function isPrivateBetaAccessEnforced(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.APP_MODE === "production"
  );
}

export function isPrivateBetaOwner(email: string): boolean {
  return (
    normalizeMembershipEmail(email) ===
    normalizeMembershipEmail(PRIVATE_BETA_OWNER_EMAIL)
  );
}

export function isCloseSpanPlatformAdmin(user: {
  email: string;
  role: string;
}): boolean {
  return user.role === "Admin" && isPrivateBetaOwner(user.email);
}

export function founderInquiryEmailUrl(email: string): string {
  const normalizedEmail = normalizeMembershipEmail(email);
  const subject = `CloseSpan product inquiry from ${normalizedEmail}`;
  const body = [
    "Hi Shanmukh,",
    "",
    `I joined the CloseSpan waitlist with ${normalizedEmail}.`,
    "",
    "I would like to learn more about CloseSpan. My question is:",
    "",
    "",
    "Thanks,",
  ].join("\n");

  return `mailto:${PUBLIC_EMAILS.hello}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
