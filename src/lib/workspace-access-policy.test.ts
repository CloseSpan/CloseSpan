import { describe, expect, it } from "vitest";
import {
  founderInquiryEmailUrl,
  isCloseSpanPlatformAdmin,
  isPrivateBetaAccessEnforced,
  isPrivateBetaOwner,
  PRIVATE_BETA_OWNER_EMAIL,
} from "./workspace-access-policy";
import { PUBLIC_EMAILS } from "./site";

describe("private beta workspace access policy", () => {
  it("allows only the founder Google identity", () => {
    expect(isPrivateBetaOwner(PRIVATE_BETA_OWNER_EMAIL)).toBe(true);
    expect(isPrivateBetaOwner("Shanmukh.Sain+beta@googlemail.com")).toBe(true);
    expect(isPrivateBetaOwner("another.person@gmail.com")).toBe(false);
    expect(isPrivateBetaOwner("shanmukhsain@example.com")).toBe(false);
  });

  it("enforces the owner boundary whenever the app is in production mode", () => {
    const previousMode = process.env.APP_MODE;
    process.env.APP_MODE = "production";
    expect(isPrivateBetaAccessEnforced()).toBe(true);
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
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

  it("builds a prefilled founder inquiry for a waitlisted user", () => {
    const url = founderInquiryEmailUrl("Prospect@Example.com");

    expect(url).toContain(`mailto:${PUBLIC_EMAILS.hello}`);
    expect(decodeURIComponent(url)).toContain(
      "CloseSpan product inquiry from prospect@example.com",
    );
    expect(decodeURIComponent(url)).toContain(
      "I joined the CloseSpan waitlist with prospect@example.com.",
    );
    expect(decodeURIComponent(url)).toContain("My question is:");
  });
});
