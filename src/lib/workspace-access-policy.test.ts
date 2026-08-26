import { describe, expect, it } from "vitest";
import {
  isCloseSpanPlatformAdmin,
  isPrivateBetaOwner,
  PRIVATE_BETA_OWNER_EMAIL,
} from "./workspace-access-policy";

describe("workspace platform access policy", () => {
  it("allows only the founder Google identity", () => {
    expect(isPrivateBetaOwner(PRIVATE_BETA_OWNER_EMAIL)).toBe(true);
    expect(isPrivateBetaOwner("Shanmukh.Sain+beta@googlemail.com")).toBe(true);
    expect(isPrivateBetaOwner("another.person@gmail.com")).toBe(false);
    expect(isPrivateBetaOwner("shanmukhsain@example.com")).toBe(false);
  });

  it("requires both the platform identity and an administrator role", () => {
    expect(isCloseSpanPlatformAdmin({
      email: PRIVATE_BETA_OWNER_EMAIL,
      role: "Admin",
    })).toBe(true);
    expect(isCloseSpanPlatformAdmin({
      email: PRIVATE_BETA_OWNER_EMAIL,
      role: "Member",
    })).toBe(false);
    expect(isCloseSpanPlatformAdmin({
      email: "another.person@gmail.com",
      role: "Admin",
    })).toBe(false);
  });

});
