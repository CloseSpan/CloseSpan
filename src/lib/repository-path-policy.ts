const NON_PRODUCT_PATH_PREFIXES = [
  ".closespan/",
  ".closespan-run/",
  ".github/",
  ".prompt/",
  "docs/",
  "documentation/",
] as const;

const NON_PRODUCT_DOCUMENT = /(?:^|\/)(?:readme|changelog|contributing|license)(?:\.[^/]*)?$/i;
const NON_PRODUCT_EXTENSION = /\.(?:md|mdx|rst|txt)$/i;
const GENERATED_LOCKFILE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

export function repositoryPathFromReference(reference: string): string {
  return reference.trim().replace(/:\d+(?:-\d+)?$/, "");
}

export function isProductCodeReference(reference: string): boolean {
  const path = repositoryPathFromReference(reference).replace(/^\.\//, "");
  const normalized = path.toLowerCase();
  if (!normalized || NON_PRODUCT_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  return !NON_PRODUCT_DOCUMENT.test(path)
    && !NON_PRODUCT_EXTENSION.test(path)
    && !GENERATED_LOCKFILE.test(path);
}
