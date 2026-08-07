import { describe, expect, it } from "vitest";
import {
  assertTrustedSnapshotPublication,
  isImmutableTenkiRegistryRef,
  snapshotPublicationLookupRef,
} from "./tenki-snapshot-publication-provenance.mjs";

const snapshotId = "81659164-c21c-46d3-954c-350e70b9af3d";
const workspaceId = "019fa584-01d1-71b8-a93b-6d052830a63d";
const builderSessionId = "019fdb21-7591-7281-8cf1-108deaf0648d";
const ownershipTag = "artifact-441595061d6e4d72b5bd024";
const uuidRef = `workspace/private-node@${snapshotId}`;
const shaRef = `workspace/private-node@sha256:${"a".repeat(64)}`;

function fixture(registryRef = uuidRef) {
  const image = {
    id: "image-1",
    workspaceId,
    workspaceSlug: "workspace",
    name: "private-node",
    visibility: "private",
    kind: "snapshot",
    labels: ["closespan", ownershipTag],
    sourceSnapshotId: snapshotId,
  };
  return {
    receipt: { image, snapshotId, digestRef: registryRef },
    snapshot: {
      id: snapshotId,
      workspaceId,
      state: "READY",
      rawImageAvailable: false,
      sessionId: builderSessionId,
      tags: ["closespan", ownershipTag],
    },
    detail: {
      image,
      workspaceActive: true,
      tombstoned: false,
      resolvedSnapshotId: snapshotId,
      resolvedRef: uuidRef,
    },
    resolved: {
      imageId: image.id,
      owningWorkspaceId: workspaceId,
      snapshotId,
      kind: "snapshot",
      visibility: "private",
      resolvedRef: uuidRef,
    },
    expectedSnapshotId: snapshotId,
    expectedWorkspaceId: workspaceId,
    expectedBuilderSessionId: builderSessionId,
    ownershipTag,
  };
}

describe("Tenki snapshot publication provenance", () => {
  it.each([uuidRef, shaRef])("accepts immutable registry reference %s", (ref) => {
    expect(isImmutableTenkiRegistryRef(ref)).toBe(true);
    const value = fixture(ref);
    value.lookupRef = snapshotPublicationLookupRef(value.receipt, snapshotId);
    expect(assertTrustedSnapshotPublication(value)).toMatchObject({
      registryRef: ref,
      image: { id: "image-1" },
      snapshot: { id: snapshotId },
    });
  });

  it.each([
    "workspace/private-node:latest",
    `workspace/private-node:latest@${snapshotId}`,
    `workspace/private-node:latest@sha256:${"a".repeat(64)}`,
    `workspace/private-node@${snapshotId}@${snapshotId}`,
  ])("rejects a mutable or malformed registry reference %s", (ref) => {
    expect(isImmutableTenkiRegistryRef(ref)).toBe(false);
  });

  it("accepts absent optional receipt and source fields when registry resolution is exact", () => {
    const value = fixture();
    value.receipt.image = undefined;
    value.detail.image.sourceSnapshotId = undefined;
    value.lookupRef = snapshotPublicationLookupRef(value.receipt, snapshotId);
    expect(assertTrustedSnapshotPublication(value).registryRef).toBe(uuidRef);
  });

  it("constructs an exact UUID-version ref when the receipt omits one", () => {
    const value = fixture("");
    expect(snapshotPublicationLookupRef(value.receipt, snapshotId)).toBe(uuidRef);
  });

  it.each([
    ["mutable ref", (value) => { value.lookupRef = "workspace/private-node:latest"; }],
    ["receipt snapshot", (value) => { value.receipt.snapshotId = crypto.randomUUID(); }],
    ["snapshot workspace", (value) => { value.snapshot.workspaceId = crypto.randomUUID(); }],
    ["builder session", (value) => { value.snapshot.sessionId = crypto.randomUUID(); }],
    ["snapshot ownership", (value) => { value.snapshot.tags = []; }],
    ["resolved snapshot", (value) => { value.detail.resolvedSnapshotId = crypto.randomUUID(); }],
    ["registry workspace", (value) => { value.detail.image.workspaceId = crypto.randomUUID(); }],
    ["registry ownership", (value) => { value.detail.image.labels = []; }],
    ["resolver image", (value) => { value.resolved.imageId = "image-2"; }],
    ["resolver workspace", (value) => { value.resolved.owningWorkspaceId = crypto.randomUUID(); }],
    ["resolver snapshot", (value) => { value.resolved.snapshotId = crypto.randomUUID(); }],
    ["inactive workspace", (value) => { value.detail.workspaceActive = false; }],
    ["tombstoned image", (value) => { value.detail.tombstoned = true; }],
  ])("rejects contradictory %s provenance", (_label, mutate) => {
    const value = fixture();
    value.lookupRef = snapshotPublicationLookupRef(value.receipt, snapshotId);
    mutate(value);
    expect(() => assertTrustedSnapshotPublication(value)).toThrow();
  });

  it("rejects a UUID version that names a different snapshot", () => {
    const value = fixture(`workspace/private-node@${crypto.randomUUID()}`);
    value.lookupRef = snapshotPublicationLookupRef(value.receipt, snapshotId);
    expect(() => assertTrustedSnapshotPublication(value)).toThrow(
      "points to a different snapshot",
    );
  });
});
