export interface TenkiBootSourceObservation {
  readonly sourceSnapshotId?: string;
  readonly sourceRegistryImageId?: string;
  readonly sourceRegistryWorkspaceId?: string;
  readonly sourceRegistryRef?: string;
}

export interface TenkiRequestedBootSource {
  readonly tenkiSnapshotId?: string | null;
  readonly tenkiImage?: string | null;
}

export interface TenkiBootSourceEvidence {
  sourceSnapshotId: string | null;
  sourceRegistryImageId: string | null;
  sourceRegistryWorkspaceId: string | null;
  sourceRegistryRef: string | null;
}

const TENKI_SNAPSHOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attest the strongest boot provenance currently returned by Tenki.
 *
 * Raw snapshot restores currently omit sourceSnapshotId in live sessions, so
 * absence cannot be treated as a mismatch. A populated, contradictory value
 * still fails closed. Image boots are accepted only when the profile pins an
 * immutable digest and the session returns the matching ref plus its resolved
 * registry and backing-snapshot identities. A mutable image tag is never
 * treated as immutable provenance.
 */
export function attestTenkiBootSource(
  session: TenkiBootSourceObservation,
  requested: TenkiRequestedBootSource,
): TenkiBootSourceEvidence {
  const evidence: TenkiBootSourceEvidence = {
    sourceSnapshotId: session.sourceSnapshotId?.trim() || null,
    sourceRegistryImageId: session.sourceRegistryImageId?.trim() || null,
    sourceRegistryWorkspaceId: session.sourceRegistryWorkspaceId?.trim() || null,
    sourceRegistryRef: session.sourceRegistryRef?.trim() || null,
  };
  const expectedSourceSnapshotId = requested.tenkiSnapshotId?.trim() || null;
  const requestedImage = requested.tenkiImage?.trim() || null;

  if (
    expectedSourceSnapshotId !== null
    && evidence.sourceSnapshotId !== null
    && evidence.sourceSnapshotId !== expectedSourceSnapshotId
  ) {
    throw new Error(
      "Tenki session boot snapshot does not match the immutable execution profile",
    );
  }

  if (requestedImage !== null) {
    const imageSource = requestedImage.split("@").at(-1) ?? "";
    const immutableImageRef = TENKI_SNAPSHOT_ID_PATTERN.test(imageSource)
      || /^sha256:[a-f0-9]{64}$/i.test(imageSource);
    if (!immutableImageRef) {
      throw new Error(
        "Tenki image boot source must be pinned to an immutable digest",
      );
    }
    if (
      evidence.sourceRegistryRef !== requestedImage
      || evidence.sourceRegistryImageId === null
      || evidence.sourceRegistryWorkspaceId === null
      || evidence.sourceSnapshotId === null
      || (
        TENKI_SNAPSHOT_ID_PATTERN.test(imageSource)
        && evidence.sourceSnapshotId !== imageSource
      )
    ) {
      throw new Error(
        "Tenki image boot source does not match the immutable execution profile",
      );
    }
  }

  return evidence;
}
