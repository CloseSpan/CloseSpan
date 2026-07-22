"use client";

import {
  Building2,
  Check,
  ChevronsUpDown,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import { useActionState, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  createOrganizationAction,
  switchOrganizationAction,
} from "@/app/organization-actions";

export interface OrganizationSwitcherItem {
  id: string;
  name: string;
  role: string;
}

type OrganizationSwitcherVariant = "sidebar" | "mobile" | "topbar";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "O"
  );
}

function SwitchButton({
  organization,
  active,
}: {
  organization: OrganizationSwitcherItem;
  active: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={`organization-option${active ? " active" : ""}`}
      aria-current={active ? "true" : undefined}
      disabled={active || pending}
    >
      <span className="organization-avatar" aria-hidden="true">
        {initials(organization.name)}
      </span>
      <span className="organization-option-copy">
        <strong>{organization.name}</strong>
        <small>{organization.role}</small>
      </span>
      {pending ? (
        <LoaderCircle className="spin" size={16} aria-hidden="true" />
      ) : active ? (
        <Check size={16} aria-hidden="true" />
      ) : null}
      <span className="sr-only">
        {active ? "Current organization" : `Switch to ${organization.name}`}
      </span>
    </button>
  );
}

function OrganizationOptions({
  organizations,
  activeOrganizationId,
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
}) {
  return (
    <div className="organization-switcher-list" role="list">
      {organizations.map((organization) => {
        const active = organization.id === activeOrganizationId;
        return (
          <form action={switchOrganizationAction} key={organization.id} role="listitem">
            <input type="hidden" name="organizationId" value={organization.id} />
            <SwitchButton organization={organization} active={active} />
          </form>
        );
      })}
    </div>
  );
}

function CreateOrganizationButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary organization-create-submit" type="submit" disabled={pending}>
      {pending ? (
        <LoaderCircle className="spin" size={16} aria-hidden="true" />
      ) : (
        <Plus size={16} aria-hidden="true" />
      )}
      {pending ? "Creating organization…" : "Create organization"}
    </button>
  );
}

export function OrganizationSwitcher({
  organizations,
  activeOrganizationId,
  variant = "sidebar",
}: {
  organizations: OrganizationSwitcherItem[];
  activeOrganizationId: string;
  variant?: OrganizationSwitcherVariant;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const organizationNameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [createState, createFormAction] = useActionState(
    createOrganizationAction,
    { error: null },
  );
  const activeOrganization =
    organizations.find((organization) => organization.id === activeOrganizationId) ??
    organizations[0];

  function openCreateDialog(): void {
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => organizationNameRef.current?.focus());
  }

  function closeCreateDialog(): void {
    dialogRef.current?.close();
  }

  const createDialog = (
    <dialog
      className="organization-create-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeCreateDialog();
      }}
    >
      <div className="organization-create-panel">
        <header className="organization-create-head">
          <div>
            <span className="eyebrow">New workspace</span>
            <h2 id={titleId}>Add an organization</h2>
            <p className="subtle" id={descriptionId}>
              Create an independent workspace with its own product profile,
              feedback, integrations, and agent activity.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close organization form"
            onClick={closeCreateDialog}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <form className="organization-create-form" action={createFormAction}>
          <label className="field">
            Organization name
            <input
              name="organizationName"
              type="text"
              autoComplete="organization"
              maxLength={120}
              required
              ref={organizationNameRef}
              placeholder="Acme, Inc."
            />
          </label>
          <label className="field">
            Product name
            <input
              name="productName"
              type="text"
              maxLength={160}
              required
              placeholder="Acme Cloud"
            />
          </label>
          <label className="field">
            Product URL
            <input
              name="productUrl"
              type="url"
              inputMode="url"
              autoComplete="url"
              maxLength={500}
              placeholder="https://acme.com"
            />
          </label>
          <label className="field">
            Product description
            <textarea
              name="productDescription"
              rows={4}
              maxLength={2000}
              required
              placeholder="What the product does, who it serves, and where customers usually share feedback."
            />
            <small>
              CloseSpan uses this context to recommend relevant feedback sources.
            </small>
          </label>
          {createState.error && (
            <p className="toast error" role="alert">
              {createState.error}
            </p>
          )}
          <div className="organization-create-actions">
            <button className="btn" type="button" onClick={closeCreateDialog}>
              Cancel
            </button>
            <CreateOrganizationButton />
          </div>
        </form>
      </div>
    </dialog>
  );

  if (variant === "mobile") {
    return (
      <section className="mobile-organizations" aria-labelledby={`${titleId}-mobile`}>
        <div className="mobile-organizations-head">
          <span id={`${titleId}-mobile`}>Organizations</span>
          <small>Independent workspaces</small>
        </div>
        <OrganizationOptions
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
        />
        <button className="organization-create-action" type="button" onClick={openCreateDialog}>
          <Plus size={16} aria-hidden="true" />
          Add organization
        </button>
        {createDialog}
      </section>
    );
  }

  return (
    <div className={`organization-switcher ${variant === "topbar" ? "compact" : ""}`}>
      <details>
        <summary
          className="organization-switcher-trigger"
          aria-label={`Switch organization. Current organization: ${activeOrganization?.name ?? "Unknown"}`}
        >
          <span className="organization-avatar" aria-hidden="true">
            {initials(activeOrganization?.name ?? "Organization")}
          </span>
          <span className="organization-trigger-copy">
            <small>Organization</small>
            <strong>{activeOrganization?.name ?? "Select organization"}</strong>
          </span>
          <ChevronsUpDown size={16} aria-hidden="true" />
        </summary>
        <div className="organization-switcher-menu">
          <div className="organization-switcher-menu-head">
            <Building2 size={16} aria-hidden="true" />
            <span>
              <strong>Organizations</strong>
              <small>Feedback stays separate</small>
            </span>
          </div>
          <OrganizationOptions
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
          />
          <button className="organization-create-action" type="button" onClick={openCreateDialog}>
            <Plus size={16} aria-hidden="true" />
            Add organization
          </button>
        </div>
      </details>
      {createDialog}
    </div>
  );
}
