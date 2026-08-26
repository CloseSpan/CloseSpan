import { normalizeMembershipEmail } from "./organization-repository";

export const PRIVATE_BETA_OWNER_EMAIL = "shanmukhsain@gmail.com";

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
