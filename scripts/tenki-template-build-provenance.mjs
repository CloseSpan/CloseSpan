export function normalizeTenkiSha256(value, label = "Tenki SHA-256 value") {
  const normalized = String(value ?? "").replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} is not a valid SHA-256 value`);
  }
  return normalized;
}

export function assertTrustedTemplateBuild({
  template,
  build,
  ownershipTag,
}) {
  if (!template?.id || !template.workspaceId) {
    throw new Error("Tenki template identity is incomplete");
  }
  if (!template.tags?.includes(ownershipTag)) {
    throw new Error("Tenki template is missing the CloseSpan ownership tag");
  }
  if (template.visibility !== "PRIVATE" || template.definitionMode !== "TYPED") {
    throw new Error("Tenki template is not a private typed template");
  }
  if (build?.state !== "READY" || !build.image || !build.snapshotId) {
    throw new Error("Tenki template build did not produce an immutable image");
  }
  if (build.templateId !== template.id) {
    throw new Error("Tenki build references a different template");
  }
  if (
    normalizeTenkiSha256(build.specHash, "Tenki build specification hash")
    !== normalizeTenkiSha256(template.specHash, "Tenki template specification hash")
  ) {
    throw new Error("Tenki build specification does not match its template");
  }

  const image = build.image;
  if (image.workspaceId !== template.workspaceId) {
    throw new Error("Tenki image belongs to a different workspace");
  }
  if (image.visibility !== "private" || image.kind !== "template") {
    throw new Error("Tenki template image is not private and immutable");
  }
  if (image.sourceTemplateId !== template.id) {
    throw new Error("Tenki image does not reference the trusted template");
  }
  if (image.sourceSnapshotId && image.sourceSnapshotId !== build.snapshotId) {
    throw new Error("Tenki image references a different source snapshot");
  }

  const digest = `sha256:${normalizeTenkiSha256(image.digest, "Tenki image digest")}`;
  if (
    !image.digestRef?.endsWith(`@${digest}`)
    || build.imageDigest !== digest
    || build.imageDigestRef !== image.digestRef
  ) {
    throw new Error("Tenki template returned a mutable or inconsistent image reference");
  }

  return {
    image,
    snapshotId: build.snapshotId,
    specHash: normalizeTenkiSha256(build.specHash, "Tenki build specification hash"),
  };
}

export function assertTrackedTemplateBuildCleanup({
  template,
  build,
  ownershipTag,
  expectedTemplateId,
  expectedWorkspaceId,
  expectedSnapshotId,
  expectedRegistryImageId,
}) {
  if (
    !template
    || template.id !== expectedTemplateId
    || template.workspaceId !== expectedWorkspaceId
    || !template.tags?.includes(ownershipTag)
  ) {
    throw new Error("Tenki template is not owned by the tracked artifact");
  }
  if (!build || build.templateId !== expectedTemplateId) {
    throw new Error("Tenki build does not reference the tracked template");
  }
  if (build.image?.workspaceId && build.image.workspaceId !== expectedWorkspaceId) {
    throw new Error("Tenki build image belongs to a different workspace");
  }
  if (build.image?.sourceTemplateId && build.image.sourceTemplateId !== expectedTemplateId) {
    throw new Error("Tenki build image references a different template");
  }
  if (expectedSnapshotId && build.snapshotId && build.snapshotId !== expectedSnapshotId) {
    throw new Error("Tenki build references a different snapshot");
  }
  if (
    expectedRegistryImageId
    && build.image?.id
    && build.image.id !== expectedRegistryImageId
  ) {
    throw new Error("Tenki build references a different registry image");
  }

  return {
    snapshotId: expectedSnapshotId ?? build.snapshotId ?? null,
    registryImageId: expectedRegistryImageId ?? build.image?.id ?? null,
  };
}
