"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  LEGACY_ACTIVE_ORGANIZATION_COOKIE,
  activeOrganizationCookieOptions,
  requireWorkspaceUser,
} from "@/lib/auth-user";
import {
  createOrganization,
  findOrganizationMembership,
} from "@/lib/organization-repository";

export interface OrganizationActionState {
  error: string | null;
}

const organizationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const createOrganizationSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
  productName: z.string().trim().max(160).optional().default(""),
  productUrl: z.string().trim().max(500).optional().default(""),
  productDescription: z.string().trim().max(2_000).optional().default(""),
});

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function normalizeProductUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function activateOrganization(organizationId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    ACTIVE_ORGANIZATION_COOKIE,
    organizationId,
    activeOrganizationCookieOptions(),
  );
  cookieStore.delete(LEGACY_ACTIVE_ORGANIZATION_COOKIE);
  revalidatePath("/", "layout");
}

export async function switchOrganizationAction(
  formData: FormData,
): Promise<void> {
  const organizationId = organizationIdSchema.safeParse(
    formValue(formData, "organizationId"),
  );
  if (!organizationId.success)
    throw new Error("Choose a valid organization");

  const user = await requireWorkspaceUser();
  const membership = await findOrganizationMembership(
    user.email,
    organizationId.data,
  );
  if (!membership) throw new Error("Organization access is not available");

  await activateOrganization(membership.organizationId);
  redirect("/overview");
}

export async function createOrganizationAction(
  _previousState: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const parsed = createOrganizationSchema.safeParse({
    organizationName: formValue(formData, "organizationName"),
    productName: formValue(formData, "productName"),
    productUrl: formValue(formData, "productUrl"),
    productDescription: formValue(formData, "productDescription"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Check the organization details and try again",
    };
  }

  const productUrl = normalizeProductUrl(parsed.data.productUrl);
  if (parsed.data.productUrl && !productUrl) {
    return { error: "Enter a valid product URL" };
  }

  const user = await requireWorkspaceUser();
  let created: Awaited<ReturnType<typeof createOrganization>>;
  try {
    created = await createOrganization({
      name: parsed.data.organizationName,
      productName: parsed.data.productName || parsed.data.organizationName,
      productUrl,
      productDescription: parsed.data.productDescription || null,
      creator: { name: user.name, email: user.email },
    });
  } catch {
    return {
      error:
        "The organization could not be created right now. Please try again.",
    };
  }

  await activateOrganization(created.organizationId);
  redirect("/overview");
}
