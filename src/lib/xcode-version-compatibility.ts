function xcodeMajor(version: string): number {
  const match = version.trim().match(/^(\d+)(?:\.\d+){0,2}$/);
  if (!match?.[1]) throw new Error(`Invalid Xcode version: ${version}`);
  return Number.parseInt(match[1], 10);
}

export function compatibleXcodeMajor(actual: string, required: string): boolean {
  return xcodeMajor(actual) === xcodeMajor(required);
}

export function xcodeMajorCompatibilityCommand(requiredVersion: string): string {
  const requiredMajor = xcodeMajor(requiredVersion);
  return [
    `actual="$(xcodebuild -version | awk 'NR == 1 && $1 == "Xcode" { print $2; exit }')"`,
    `test -n "$actual"`,
    `test "\${actual%%.*}" = "${requiredMajor}" || { printf 'Tenki runner Xcode %s is not compatible with approved Xcode ${requiredVersion}\\n' "$actual" >&2; exit 1; }`,
    `printf 'Validated Xcode %s for approved Xcode ${requiredVersion}\\n' "$actual"`,
  ].join("; ");
}
