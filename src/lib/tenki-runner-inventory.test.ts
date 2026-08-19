import { describe, expect, it, vi } from "vitest";
import {
  configuredRunnerInventory,
  discoverAvailableRunnerInventory,
  selectCompatibleRunner,
  type AvailableRunnerInventoryEntry,
} from "./tenki-runner-inventory";
import type { TenkiRunnerWorkloadAssessment } from "./tenki-runner-sizing";

const iosWorkload: TenkiRunnerWorkloadAssessment = {
  workloadClass: "ios_simulator",
  platform: "macos",
  baselineRunnerLabel: "tenki-macos-15-small",
  reasons: ["iOS Simulator build"],
};

const androidWorkload: TenkiRunnerWorkloadAssessment = {
  workloadClass: "android_emulator",
  platform: "linux",
  baselineRunnerLabel: "tenki-standard-large-8c-16g",
  reasons: ["Android Emulator requires nested KVM"],
};

function runner(
  overrides: Partial<AvailableRunnerInventoryEntry> = {},
): AvailableRunnerInventoryEntry {
  return {
    label: "tenki-macos-26-small",
    provider: "tenki",
    source: "deployment_catalog",
    platform: "macos",
    architecture: "arm64",
    cpuCores: 4,
    memoryMb: 8_192,
    xcodeMajors: [26],
    androidApiLevels: [],
    nestedKvm: false,
    online: true,
    ...overrides,
  };
}

describe("Tenki runner inventory and compatibility selection", () => {
  it("selects the smallest enabled Tenki runner only after platform and Xcode compatibility", () => {
    const selection = selectCompatibleRunner({
      platform: "ios",
      xcodeVersion: "26.1",
      workload: iosWorkload,
      inventory: [
        runner({ label: "tenki-macos-15-small", xcodeMajors: [15] }),
        runner({ label: "tenki-macos-26-large", cpuCores: 8, memoryMb: 32_768 }),
        runner(),
      ],
    });

    expect(selection).toMatchObject({
      label: "tenki-macos-26-small",
      provider: "tenki",
      source: "deployment_catalog",
      cpuCores: 4,
      memoryMb: 8_192,
      fallbackReason: null,
      compatibleCandidateCount: 2,
      compatibleCandidates: [
        { label: "tenki-macos-26-small", cpuCores: 4, memoryMb: 8_192 },
        { label: "tenki-macos-26-large", cpuCores: 8, memoryMb: 32_768 },
      ],
    });
  });

  it("uses a clearly identified GitHub-hosted fallback when no compatible Tenki runner exists", () => {
    const selection = selectCompatibleRunner({
      platform: "ios",
      xcodeVersion: "26.1",
      workload: iosWorkload,
      inventory: [runner({ label: "tenki-macos-15-small", xcodeMajors: [15] })],
    });

    expect(selection).toMatchObject({
      label: "macos-26",
      provider: "github_hosted",
      source: "github_hosted_fallback",
      fallbackReason: "No enabled Tenki runner matched Xcode 26 on Apple Silicon",
      compatibleCandidateCount: 0,
    });
  });

  it("fails closed instead of silently choosing hosted infrastructure when fallback is disabled", () => {
    expect(() => selectCompatibleRunner({
      platform: "ios",
      xcodeVersion: "26.0",
      workload: iosWorkload,
      inventory: [],
      githubHostedFallbackEnabled: false,
    })).toThrow("No compatible Tenki macos runner is enabled for this repository");
  });

  it("requires Android nested KVM, API compatibility, architecture, and sufficient capacity", () => {
    const selection = selectCompatibleRunner({
      platform: "android",
      androidApiLevel: 34,
      workload: androidWorkload,
      inventory: [
        runner({
          label: "tenki-android-no-kvm",
          platform: "linux",
          architecture: "x64",
          cpuCores: 8,
          memoryMb: 16_384,
          xcodeMajors: [],
          androidApiLevels: [34],
          nestedKvm: false,
        }),
        runner({
          label: "tenki-android-api-33",
          platform: "linux",
          architecture: "x64",
          cpuCores: 8,
          memoryMb: 16_384,
          xcodeMajors: [],
          androidApiLevels: [33],
          nestedKvm: true,
        }),
        runner({
          label: "tenki-android-api-34-large",
          platform: "linux",
          architecture: "x64",
          cpuCores: 8,
          memoryMb: 16_384,
          xcodeMajors: [],
          androidApiLevels: [34],
          nestedKvm: true,
        }),
      ],
    });

    expect(selection).toMatchObject({
      label: "tenki-android-api-34-large",
      provider: "tenki",
      platform: "linux",
      architecture: "x64",
      compatibleCandidateCount: 1,
    });
  });

  it("scopes the deployment catalog and enriches labels discovered from GitHub", async () => {
    const catalogJson = JSON.stringify([
      {
        label: "tenki-macos-26-small",
        repository: "samshanmukh/zup",
        platform: "macos",
        architecture: "arm64",
        cpuCores: 4,
        memoryMb: 8192,
        xcodeMajors: [26],
      },
      {
        label: "tenki-other",
        repository: "acme/other",
        platform: "linux",
        architecture: "x64",
      },
    ]);
    expect(configuredRunnerInventory({
      orgId: "org-1",
      repository: "samshanmukh/zup",
      catalogJson,
    }).map((entry) => entry.label)).toEqual(["tenki-macos-26-small"]);

    const request = vi.fn()
      .mockResolvedValueOnce({
        data: {
          runners: [{
            status: "online",
            labels: [{ name: "self-hosted" }, { name: "tenki-macos-26-small" }],
          }],
        },
      })
      .mockResolvedValueOnce({ data: { runners: [] } });
    const inventory = await discoverAvailableRunnerInventory({
      orgId: "org-1",
      installationId: "installation-1",
      repository: "samshanmukh/zup",
    }, {
      catalogJson,
      createClient: async () => ({ request }) as never,
    });

    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/runners",
      { owner: "samshanmukh", repo: "zup", per_page: 100 },
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(inventory).toEqual([
      expect.objectContaining({
        label: "tenki-macos-26-small",
        source: "github_self_hosted",
        xcodeMajors: [26],
        online: true,
      }),
    ]);
  });

  it("keeps a reviewed JIT catalog label when GitHub reports no idle runner", async () => {
    const catalogJson = JSON.stringify([{
      label: "tenki-macos-26-small",
      repository: "samshanmukh/zup",
      platform: "macos",
      architecture: "arm64",
      cpuCores: 4,
      memoryMb: 8192,
      xcodeMajors: [26],
    }]);
    const request = vi.fn().mockResolvedValueOnce({ data: { runners: [] } });

    await expect(discoverAvailableRunnerInventory({
      orgId: "org-1",
      installationId: "installation-1",
      repository: "samshanmukh/zup",
    }, {
      catalogJson,
      createClient: async () => ({ request }) as never,
    })).resolves.toEqual([
      expect.objectContaining({
        label: "tenki-macos-26-small",
        source: "deployment_catalog",
        xcodeMajors: [26],
      }),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("uses the reviewed catalog when GitHub runner discovery permission is unavailable", async () => {
    const catalogJson = JSON.stringify([{
      label: "tenki-macos-26-small",
      repository: "samshanmukh/zup",
      platform: "macos",
      architecture: "arm64",
      cpuCores: 4,
      memoryMb: 8192,
      xcodeMajors: [26],
    }]);
    const request = vi.fn().mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));

    await expect(discoverAvailableRunnerInventory({
      orgId: "org-1",
      installationId: "installation-1",
      repository: "samshanmukh/zup",
    }, {
      catalogJson,
      createClient: async () => ({ request }) as never,
    })).resolves.toEqual([
      expect.objectContaining({
        label: "tenki-macos-26-small",
        source: "deployment_catalog",
      }),
    ]);
  });
});
