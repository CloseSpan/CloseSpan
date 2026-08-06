import { describe, expect, it } from "vitest";
import { attestTenkiBootSource } from "./tenki-boot-source-attestation";

describe("Tenki boot-source attestation", () => {
  it("accepts and records the exact immutable source snapshot", () => {
    expect(attestTenkiBootSource(
      { sourceSnapshotId: "snapshot-profile-1" },
      { tenkiSnapshotId: "snapshot-profile-1", tenkiImage: null },
    )).toEqual({
      sourceSnapshotId: "snapshot-profile-1",
      sourceRegistryImageId: null,
      sourceRegistryWorkspaceId: null,
      sourceRegistryRef: null,
    });
  });

  it("accepts an unreported raw snapshot but rejects contradictory provenance", () => {
    expect(attestTenkiBootSource(
      {},
      { tenkiSnapshotId: "snapshot-profile-1", tenkiImage: null },
    )).toEqual({
      sourceSnapshotId: null,
      sourceRegistryImageId: null,
      sourceRegistryWorkspaceId: null,
      sourceRegistryRef: null,
    });
    expect(() => attestTenkiBootSource(
      { sourceSnapshotId: "snapshot-other" },
      { tenkiSnapshotId: "snapshot-profile-1", tenkiImage: null },
    )).toThrow("boot snapshot does not match");
  });

  it("attests a digest-pinned image from exact resolved registry provenance", () => {
    const snapshotId = "d578a017-eb4b-4a3f-b7d5-1753f9261fc1";
    const digestRef = `workspace/node@${snapshotId}`;
    expect(attestTenkiBootSource(
      {
        sourceSnapshotId: snapshotId,
        sourceRegistryImageId: "image-1",
        sourceRegistryWorkspaceId: "workspace-1",
        sourceRegistryRef: digestRef,
      },
      { tenkiSnapshotId: null, tenkiImage: digestRef },
    )).toEqual({
      sourceSnapshotId: snapshotId,
      sourceRegistryImageId: "image-1",
      sourceRegistryWorkspaceId: "workspace-1",
      sourceRegistryRef: digestRef,
    });
  });

  it("rejects mutable or incompletely attested image sources", () => {
    const snapshotId = "d578a017-eb4b-4a3f-b7d5-1753f9261fc1";
    const digestRef = `workspace/node@${snapshotId}`;
    expect(() => attestTenkiBootSource(
      { sourceRegistryRef: "workspace/node:latest" },
      { tenkiSnapshotId: null, tenkiImage: "workspace/node:latest" },
    )).toThrow("pinned to an immutable digest");
    expect(() => attestTenkiBootSource(
      {
        sourceSnapshotId: snapshotId,
        sourceRegistryImageId: "image-1",
        sourceRegistryWorkspaceId: "workspace-1",
        sourceRegistryRef: `workspace/node@11111111-1111-4111-8111-111111111111`,
      },
      { tenkiSnapshotId: null, tenkiImage: digestRef },
    )).toThrow("image boot source does not match");
  });
});
