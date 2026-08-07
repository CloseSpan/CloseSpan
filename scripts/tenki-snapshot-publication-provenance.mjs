const TENKI_SNAPSHOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENKI_IMMUTABLE_REGISTRY_REF =
  /^[a-z0-9][a-z0-9._/-]{1,399}@(sha256:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function registryVersion(value) {
  return TENKI_IMMUTABLE_REGISTRY_REF.exec(String(value ?? "").trim())?.[1] ?? null;
}

export function isImmutableTenkiRegistryRef(value) {
  return registryVersion(value) !== null;
}

export function snapshotPublicationLookupRef(receipt, expectedSnapshotId) {
  const returnedRef = String(receipt?.digestRef ?? "").trim();
  if (isImmutableTenkiRegistryRef(returnedRef)) return returnedRef;
  const workspaceSlug = String(receipt?.image?.workspaceSlug ?? "").trim();
  const imageName = String(receipt?.image?.name ?? "").trim();
  if (
    workspaceSlug
    && imageName
    && TENKI_SNAPSHOT_ID_PATTERN.test(expectedSnapshotId)
  ) {
    return `${workspaceSlug}/${imageName}@${expectedSnapshotId}`;
  }
  throw new Error("Tenki snapshot publication did not return a resolvable immutable image");
}

export function assertTrustedSnapshotPublication({
  receipt,
  lookupRef,
  snapshot,
  detail,
  resolved,
  expectedSnapshotId,
  expectedWorkspaceId,
  expectedBuilderSessionId,
  ownershipTag,
}) {
  const registryRef = String(lookupRef ?? "").trim();
  const registrySource = registryVersion(registryRef) ?? "";
  if (!isImmutableTenkiRegistryRef(registryRef)) {
    throw new Error("Tenki snapshot publication returned a mutable registry reference");
  }
  if (receipt?.snapshotId !== expectedSnapshotId) {
    throw new Error("Tenki publication receipt references a different snapshot");
  }
  if (
    snapshot?.id !== expectedSnapshotId
    || snapshot.workspaceId !== expectedWorkspaceId
    || snapshot.state !== "READY"
    || snapshot.sessionId !== expectedBuilderSessionId
    || !snapshot.tags?.includes(ownershipTag)
  ) {
    throw new Error("Tenki snapshot provenance does not match the private build");
  }
  if (
    TENKI_SNAPSHOT_ID_PATTERN.test(registrySource)
    && registrySource !== expectedSnapshotId
  ) {
    throw new Error("Tenki snapshot-version reference points to a different snapshot");
  }

  for (const canonicalRef of [detail.resolvedRef, resolved.resolvedRef]) {
    if (!canonicalRef) continue;
    const canonicalSource = registryVersion(canonicalRef) ?? "";
    if (!TENKI_SNAPSHOT_ID_PATTERN.test(canonicalSource)
      || canonicalSource !== expectedSnapshotId) {
      throw new Error("Tenki canonical registry reference points to a different snapshot");
    }
  }

  const image = detail?.image;
  if (
    !image
    || detail.workspaceActive !== true
    || detail.tombstoned
    || detail.resolvedSnapshotId !== expectedSnapshotId
    || image.workspaceId !== expectedWorkspaceId
    || image.visibility !== "private"
    || image.kind !== "snapshot"
    || !image.labels?.includes(ownershipTag)
  ) {
    throw new Error("Tenki registry image provenance does not match the private build");
  }
  if (image.sourceSnapshotId && image.sourceSnapshotId !== expectedSnapshotId) {
    throw new Error("Tenki registry image references a different source snapshot");
  }

  if (
    !resolved
    || resolved.imageId !== image.id
    || resolved.owningWorkspaceId !== expectedWorkspaceId
    || resolved.snapshotId !== expectedSnapshotId
    || resolved.kind !== "snapshot"
    || resolved.visibility !== "private"
  ) {
    throw new Error("Tenki registry resolution does not match the private build");
  }

  const receiptImage = receipt.image;
  if (
    receiptImage
    && (
      receiptImage.id !== image.id
      || receiptImage.workspaceId !== expectedWorkspaceId
      || receiptImage.visibility !== "private"
      || receiptImage.kind !== "snapshot"
      || (
        receiptImage.sourceSnapshotId
        && receiptImage.sourceSnapshotId !== expectedSnapshotId
      )
    )
  ) {
    throw new Error("Tenki publication receipt returned contradictory image metadata");
  }

  return { image, snapshot, registryRef };
}
