import { describe, expect, it } from "vitest";
import {
  assertTrackedTemplateBuildCleanup,
  assertTrustedTemplateBuild,
} from "./tenki-template-build-provenance.mjs";

const sha = "a".repeat(64);
const digest = `sha256:${"b".repeat(64)}`;
const ownershipTag = "artifact-12345678901234567890123";

function fixture() {
  const template = {
    id: "template-1",
    workspaceId: "workspace-1",
    specHash: `sha256:${sha}`,
    tags: ["closespan", ownershipTag],
    visibility: "PRIVATE",
    definitionMode: "TYPED",
  };
  const image = {
    id: "image-1",
    workspaceId: "workspace-1",
    kind: "template",
    visibility: "private",
    labels: [],
    sourceTemplateId: "template-1",
    sourceSnapshotId: undefined,
    digest,
    digestRef: `workspace/catalog@${digest}`,
  };
  const build = {
    id: "build-1",
    templateId: "template-1",
    state: "READY",
    specHash: `sha256:${sha}`,
    snapshotId: "snapshot-1",
    image,
    imageDigest: digest,
    imageDigestRef: image.digestRef,
  };
  return { template, build };
}

describe("assertTrustedTemplateBuild", () => {
  it("accepts a label-free image when the tagged template and immutable source chain match", () => {
    const { template, build } = fixture();
    expect(assertTrustedTemplateBuild({ template, build, ownershipTag })).toMatchObject({
      snapshotId: "snapshot-1",
      specHash: sha,
    });
  });

  it.each([
    ["template id", (value) => { value.build.templateId = "template-2"; }],
    ["spec hash", (value) => { value.build.specHash = `sha256:${"c".repeat(64)}`; }],
    ["workspace", (value) => { value.build.image.workspaceId = "workspace-2"; }],
    ["source template", (value) => { value.build.image.sourceTemplateId = "template-2"; }],
    ["source snapshot", (value) => { value.build.image.sourceSnapshotId = "snapshot-2"; }],
    ["visibility", (value) => { value.build.image.visibility = "public"; }],
    ["kind", (value) => { value.build.image.kind = "snapshot"; }],
    ["digest", (value) => { value.build.imageDigest = `sha256:${"c".repeat(64)}`; }],
  ])("rejects a contradictory %s", (_label, mutate) => {
    const value = fixture();
    mutate(value);
    expect(() => assertTrustedTemplateBuild({
      ...value,
      ownershipTag,
    })).toThrow();
  });
});

describe("assertTrackedTemplateBuildCleanup", () => {
  it("accepts a failed child build with no immutable outputs when its tagged template matches", () => {
    const { template, build } = fixture();
    build.state = "FAILED";
    build.snapshotId = undefined;
    build.image = undefined;

    expect(assertTrackedTemplateBuildCleanup({
      template,
      build,
      ownershipTag,
      expectedTemplateId: template.id,
      expectedWorkspaceId: template.workspaceId,
      expectedSnapshotId: null,
      expectedRegistryImageId: null,
    })).toEqual({ snapshotId: null, registryImageId: null });
  });

  it("recovers unpersisted immutable outputs from an exactly linked build", () => {
    const { template, build } = fixture();
    expect(assertTrackedTemplateBuildCleanup({
      template,
      build,
      ownershipTag,
      expectedTemplateId: template.id,
      expectedWorkspaceId: template.workspaceId,
      expectedSnapshotId: null,
      expectedRegistryImageId: null,
    })).toEqual({ snapshotId: "snapshot-1", registryImageId: "image-1" });
  });

  it.each([
    ["template ownership", (value) => { value.template.tags = ["closespan"]; }],
    ["template workspace", (value) => { value.template.workspaceId = "workspace-2"; }],
    ["build template", (value) => { value.build.templateId = "template-2"; }],
    ["image workspace", (value) => { value.build.image.workspaceId = "workspace-2"; }],
    ["image source", (value) => { value.build.image.sourceTemplateId = "template-2"; }],
    ["tracked snapshot", (value) => { value.build.snapshotId = "snapshot-2"; }],
    ["tracked image", (value) => { value.build.image.id = "image-2"; }],
  ])("rejects contradictory cleanup provenance: %s", (_label, mutate) => {
    const value = fixture();
    mutate(value);
    expect(() => assertTrackedTemplateBuildCleanup({
      ...value,
      ownershipTag,
      expectedTemplateId: "template-1",
      expectedWorkspaceId: "workspace-1",
      expectedSnapshotId: "snapshot-1",
      expectedRegistryImageId: "image-1",
    })).toThrow();
  });
});
