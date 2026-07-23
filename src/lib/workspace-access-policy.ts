import { normalizeMembershipEmail } from "./organization-repository";

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

  return `mailto:${PRIVATE_BETA_OWNER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
