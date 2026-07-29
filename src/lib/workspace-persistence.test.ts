import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  mode: "postgres" as "memory" | "postgres",
}));

vi.mock("./db", () => ({
  persistenceMode: () => database.mode,
}));

import {
  isMemoryDemoOrganization,
  memoryDemoOrganizationId,
  workspacePersistenceMode,
} from "./workspace-persistence";

describe("workspace persistence routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    database.mode = "postgres";
  });

  it("keeps only the configured demo organization in memory", () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("DEMO_MEMORY_ORG_ID", "org_demo");

    expect(memoryDemoOrganizationId()).toBe("org_demo");
    expect(isMemoryDemoOrganization("org_demo")).toBe(true);
    expect(workspacePersistenceMode("org_demo")).toBe("memory");
    expect(workspacePersistenceMode("org_customer")).toBe("postgres");
  });

  it("keeps the explicitly configured demo isolated in production", () => {
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("DEMO_MEMORY_ORG_ID", "org_demo");

    expect(isMemoryDemoOrganization("org_demo")).toBe(true);
    expect(workspacePersistenceMode("org_demo")).toBe("memory");
    expect(workspacePersistenceMode("org_customer")).toBe("postgres");
  });

  it("preserves all-memory unit tests when no durable mode is configured", () => {
    database.mode = "memory";
    vi.stubEnv("APP_MODE", "demo");

    expect(workspacePersistenceMode("org_customer")).toBe("memory");
  });
});
