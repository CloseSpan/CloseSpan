import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_POPUP_RESULT_PREFIX, requestGithubInstallUrl, startGithubInstallationPopup } from "./github-installation-client";

describe("requestGithubInstallUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts GitHub App setup for the current workspace", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ installUrl: "https://github.com/apps/closespan/installations/new?state=signed" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestGithubInstallUrl("org_test")).resolves.toBe(
      "https://github.com/apps/closespan/installations/new?state=signed",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/github",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-org-id": "org_test" }),
      }),
    );
  });

  it("surfaces the server error instead of leaving the button inert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(
        { error: "Administrator permission is required" },
        { status: 403 },
      )),
    );

    await expect(requestGithubInstallUrl("org_test")).rejects.toThrow(
      "Administrator permission is required",
    );
  });
});

describe("startGithubInstallationPopup", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function browser() {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    const popup = {
      opener: {} as unknown,
      closed: false,
      close: vi.fn(),
      location: { href: "about:blank", replace: vi.fn() },
      document: { getElementById: vi.fn(() => null as { dataset: Record<string, string | undefined> } | null) },
    };
    const open = vi.fn(() => popup);
    const localStorage = {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    };
    vi.stubGlobal("window", { open, location: { origin: "https://closespan.com", assign: vi.fn() }, localStorage });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json({ installUrl: "https://github.com/apps/closespan/installations/new?state=signed" }));
    vi.stubGlobal("fetch", fetchMock);
    const channel = () => JSON.parse(fetchMock.mock.calls[0][1]?.body as string).popupChannel as string;
    const result = (status: "connected" | "error" = "connected", reason?: string) => ({ channel: channel(), status, reason, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    return { popup, open, localStorage, storage, fetchMock, channel, result };
  }

  it("opens synchronously, removes opener access, and leaves the main window unchanged", async () => {
    const b = browser();
    const controller = new AbortController();
    const promise = startGithubInstallationPopup("org_test", { returnTo: "/onboarding", signal: controller.signal });
    expect(b.open).toHaveBeenCalledWith("about:blank", expect.stringContaining("closespan-github-"), expect.any(String));
    expect(b.popup.opener).toBeNull();
    expect(JSON.parse(b.fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ popup: true, returnTo: "/onboarding" });
    await vi.advanceTimersByTimeAsync(1);
    expect(b.popup.location.replace).toHaveBeenCalledWith("https://github.com/apps/closespan/installations/new?state=signed");
    const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(b.popup.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails immediately with an actionable error when popups are blocked", async () => {
    const b = browser();
    b.open.mockReturnValueOnce(null as unknown as typeof b.popup);
    await expect(startGithubInstallationPopup("org_test")).rejects.toThrow("Allow pop-ups");
    expect(b.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["not-a-url", "https://evil.example/apps/closespan/installations/new", "javascript:alert(1)", "https://github.com/login", "https://user:secret@github.com/apps/closespan/installations/new"])("rejects invalid popup destinations: %s", async (installUrl) => {
    const b = browser();
    b.fetchMock.mockResolvedValueOnce(Response.json({ installUrl }));
    await expect(startGithubInstallationPopup("org_test")).rejects.toThrow("invalid installation address");
    expect(b.popup.location.replace).not.toHaveBeenCalled();
    expect(b.popup.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes the blank popup and cleans timers on a request failure", async () => {
    const b = browser();
    b.fetchMock.mockResolvedValueOnce(Response.json({ error: "Administrator permission is required" }, { status: 403 }));
    await expect(startGithubInstallationPopup("org_test")).rejects.toThrow("Administrator permission");
    expect(b.popup.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels when the blank popup is closed before the install request completes", async () => {
    const b = browser();
    b.fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const promise = startGithubInstallationPopup("org_test");
    const rejection = expect(promise).rejects.toThrow("window was closed");
    b.popup.closed = true;
    await vi.advanceTimersByTimeAsync(300);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect((b.fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("accepts only a same-origin verified result with the matching attempt channel", async () => {
    const b = browser();
    const promise = startGithubInstallationPopup("org_test");
    await vi.advanceTimersByTimeAsync(1);
    b.popup.location.href = "https://evil.example/github/connection-result";
    b.popup.document.getElementById.mockReturnValue({ dataset: b.result() });
    await vi.advanceTimersByTimeAsync(300);
    expect(b.popup.close).not.toHaveBeenCalled();
    b.popup.location.href = "https://closespan.com/github/connection-result?receipt=signed";
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBeUndefined();
    expect(b.popup.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the verified same-origin result channel after COOP detaches the popup", async () => {
    const b = browser();
    const promise = startGithubInstallationPopup("org_test");
    await vi.advanceTimersByTimeAsync(1);
    b.popup.closed = true;
    b.storage.set(`${GITHUB_POPUP_RESULT_PREFIX}${b.channel()}`, JSON.stringify(b.result()));
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBeUndefined();
    expect(b.storage.size).toBe(0);
  });

  it("surfaces callback failures and discards stale or mismatched results", async () => {
    const b = browser();
    const promise = startGithubInstallationPopup("org_test");
    await vi.advanceTimersByTimeAsync(1);
    const key = `${GITHUB_POPUP_RESULT_PREFIX}${b.channel()}`;
    b.storage.set(key, JSON.stringify({ ...b.result(), channel: "other-attempt" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(b.popup.close).not.toHaveBeenCalled();
    b.storage.set(key, JSON.stringify({ ...b.result(), expiresAt: new Date(Date.now() - 1).toISOString() }));
    await vi.advanceTimersByTimeAsync(300);
    expect(b.popup.close).not.toHaveBeenCalled();
    b.storage.set(key, JSON.stringify(b.result("error", "authentication_required")));
    const rejection = expect(promise).rejects.toThrow("session expired");
    await vi.advanceTimersByTimeAsync(300);
    await rejection;
  });

  it("cleans up an abandoned popup after the bounded timeout", async () => {
    const b = browser();
    const promise = startGithubInstallationPopup("org_test");
    const rejection = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await rejection;
    expect(b.popup.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
