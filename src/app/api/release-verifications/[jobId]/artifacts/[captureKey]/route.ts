import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { databasePool } from "@/lib/db";
import { noStoreHeaders } from "@/lib/request-security";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string; captureKey: string }> },
) {
  const user = await requireWorkspaceUser();
  const { jobId, captureKey } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || captureKey.length > 200)
    return NextResponse.json({ error: "Artifact was not found" }, { status: 404, headers: noStoreHeaders });
  const result = await databasePool().query<{
    verification_result: { captures?: Array<{ key?: string; screenshotBase64?: string | null }> } | null;
  }>(
    `SELECT verification_result FROM post_release_verification_jobs
      WHERE org_id=$1 AND id=$2 AND status IN ('Passed','Failed')`,
    [user.orgId, jobId],
  );
  const capture = result.rows[0]?.verification_result?.captures?.find((item) => item.key === captureKey);
  if (!capture?.screenshotBase64 || capture.screenshotBase64.length > 450_000)
    return NextResponse.json({ error: "Artifact was not found" }, { status: 404, headers: noStoreHeaders });
  const bytes = Buffer.from(capture.screenshotBase64, "base64");
  if (bytes.byteLength < 8 || bytes.byteLength > 337_500
    || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return NextResponse.json({ error: "Artifact is invalid" }, { status: 422, headers: noStoreHeaders });
  return new Response(bytes, {
    headers: {
      ...noStoreHeaders,
      "content-type": "image/png",
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${captureKey.replace(/[^a-z0-9_-]+/gi, "-")}.png"`,
      "x-content-type-options": "nosniff",
    },
  });
}
