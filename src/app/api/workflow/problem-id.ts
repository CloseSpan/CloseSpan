import type { NextRequest } from "next/server";
import { HttpError } from "@/lib/request-security";

/**
 * Optional `?problemId=` scoping a legacy workflow request to one issue.
 * Without it, requests act on the workspace's primary workflow as before.
 */
export function workflowProblemId(request: NextRequest): string | null {
  const value = request.nextUrl.searchParams.get("problemId");
  if (value === null) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpError(400, "Invalid problem id");
  return value;
}
