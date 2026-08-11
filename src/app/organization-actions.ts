"use server";

import { randomUUID } from "node:crypto";
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
  deleteOrganization,
  renameOrganization,
} from "@/lib/organization-repository";
import { workspacePersistenceMode } from "@/lib/workspace-persistence";
import { addDefaultHttpsScheme } from "@/lib/product-url";

export interface OrganizationActionState {
  error: string | null;
}

export interface RenameOrganizationActionState extends OrganizationActionState {
  success: boolean;
}

export type DeleteOrganizationActionState = OrganizationActionState;

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

const renameWorkspaceSchema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(1, "Enter a workspace name")
    .max(120, "Workspace name must be 120 characters or fewer"),
});

const deleteOrganizationSchema = z.object({
  confirmationName: z.string().trim().min(1).max(120),
});

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function normalizeProductUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = addDefaultHttpsScheme(trimmed);
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
  const organization = user.organizations.find(
    (candidate) => candidate.id === organizationId.data,
  );
  if (!organization) throw new Error("Organization access is not available");

  await activateOrganization(organization.id);
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
  } catch (error) {
    console.error("[organization:create]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      error:
        "The organization could not be created right now. Please try again.",
    };
  }

  await activateOrganization(created.organizationId);
  redirect("/overview");
}

export async function renameOrganizationAction(
  _previousState: RenameOrganizationActionState,
  formData: FormData,
): Promise<RenameOrganizationActionState> {
  const parsed = renameWorkspaceSchema.safeParse({
    workspaceName: formValue(formData, "workspaceName"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a valid workspace name",
      success: false,
    };
  }

  const user = await requireWorkspaceUser();
  if (user.role !== "Admin") {
    return {
      error: "Only workspace administrators can rename this workspace.",
      success: false,
    };
  }
  if (workspacePersistenceMode(user.orgId) !== "postgres") {
    return {
      error: "The seeded demo workspace cannot be renamed.",
      success: false,
    };
  }

  try {
    await renameOrganization({
      orgId: user.orgId,
      name: parsed.data.workspaceName,
      actor: {
        actorId: user.id,
        actorName: user.name,
        traceId: `workspace_rename_${randomUUID()}`,
      },
    });
  } catch (error) {
    console.error("[organization:rename]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      error: "The workspace could not be renamed right now. Please try again.",
      success: false,
    };
  }

  revalidatePath("/", "layout");
  return { error: null, success: true };
}

export async function deleteOrganizationAction(
  _previousState: DeleteOrganizationActionState,
  formData: FormData,
): Promise<DeleteOrganizationActionState> {
  const parsed = deleteOrganizationSchema.safeParse({
    confirmationName: formValue(formData, "confirmationName"),
  });
  if (!parsed.success) {
    return { error: "Enter the organization name to confirm deletion." };
  }

  const user = await requireWorkspaceUser();
  if (user.role !== "Admin") {
    return { error: "Only organization administrators can delete this organization." };
  }
  if (workspacePersistenceMode(user.orgId) !== "postgres") {
    return { error: "The seeded demo organization cannot be deleted." };
  }
  if (parsed.data.confirmationName !== user.organizationName) {
    return { error: `Enter ${user.organizationName} exactly to confirm deletion.` };
  }

  const nextOrganization = user.organizations.find(
    (organization) => organization.id !== user.orgId,
  );
  if (!nextOrganization) {
    return {
      error: "Create another organization before deleting your only organization.",
    };
  }

  try {
    await deleteOrganization({
      orgId: user.orgId,
      actorMemberId: user.id,
    });
  } catch (error) {
    console.error("[organization:delete]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      error: "The organization could not be deleted right now. Please try again.",
    };
  }

  await activateOrganization(nextOrganization.id);
  redirect("/overview");
}
