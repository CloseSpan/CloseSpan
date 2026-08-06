import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const repository = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock("@/lib/runtime-secret-repository", () => ({
  createRuntimeSecret: repository.create,
  listRuntimeSecretMetadata: repository.list,
  revokeRuntimeSecretVersion: repository.revoke,
  rotateRuntimeSecret: repository.rotate,
}));

import { DELETE, GET, POST, PUT } from "./route";

const secretId = "d53e4d93-d274-48f6-93a2-4f826fd3a4df";
const metadata = {
  id: secretId,
  environmentName: "DATABASE_URL",
  label: "Staging database",
  scopeType: "repository",
  repository: "acme/app",
  workspaceRoot: ".",
  createdAt: "2026-08-01T00:00:00.000Z",
  versions: [{
    version: 1,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
  }],
};

function request(method = "GET", body?: unknown, role = "Admin") {
  return new NextRequest("http://localhost/api/settings/runtime-secrets", {
    method,
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "idempotency-key": `runtime_${crypto.randomUUID().replaceAll("-", "")}`,
      "x-test-auth": "user",
      "x-test-user-org-id": "org-1",
      "x-test-user-role": role,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("runtime secret settings API", () => {
  beforeEach(() => {
    repository.create.mockReset().mockResolvedValue(metadata);
    repository.list.mockReset().mockResolvedValue([metadata]);
    repository.revoke.mockReset().mockResolvedValue({
      ...metadata,
      versions: [{ ...metadata.versions[0], active: false }],
    });
    repository.rotate.mockReset().mockResolvedValue({
      ...metadata,
      versions: [
        { ...metadata.versions[0], version: 2 },
        { ...metadata.versions[0], active: false },
      ],
    });
  });

  it("returns metadata to administrators without secret material", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.text();
    expect(body).toContain("DATABASE_URL");
    expect(body).not.toContain("ciphertext");
    expect(body).not.toContain("encrypted_value");
    expect(repository.list).toHaveBeenCalledWith("org-1");

    const forbidden = await GET(request("GET", undefined, "Contributor"));
    expect(forbidden.status).toBe(403);
  });

  it("accepts a write-only value but never returns it", async () => {
    const value = "postgres://write-only-secret";
    const response = await POST(request("POST", {
      environmentName: "DATABASE_URL",
      label: "Staging database",
      scopeType: "repository",
      repository: "acme/app",
      value,
    }));

    expect(response.status).toBe(201);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      value,
    }));
    expect(await response.text()).not.toContain(value);
  });

  it("rotates and revokes exact versions through admin-only mutations", async () => {
    const rotate = await PUT(request("PUT", {
      secretId,
      value: "rotated-value",
      revokePrevious: true,
    }));
    expect(rotate.status).toBe(200);
    expect(repository.rotate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      secretId,
      revokePrevious: true,
    }));
    expect(await rotate.text()).not.toContain("rotated-value");

    const revoke = await DELETE(request("DELETE", {
      secretId,
      version: 2,
      reason: "Credential replaced",
    }));
    expect(revoke.status).toBe(200);
    expect(repository.revoke).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      secretId,
      version: 2,
    }));
  });
});
