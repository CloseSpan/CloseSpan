import { useEffect, useRef, useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColorTheme } from "@/lib/color-theme";
import { LandingProductVideo } from "./landing-product-video";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
  useRef: vi.fn(),
  useSyncExternalStore: vi.fn(),
}));

describe("LandingProductVideo theme changes", () => {
  let video: ReturnType<typeof makeVideo>;
  let loadedTheme: { current: ColorTheme };
  let pendingPlayback: { current: unknown };
  let cleanup: (() => void) | undefined;

  function makeVideo() {
    const media = Object.assign(new EventTarget(), {
      readyState: 0, currentTime: 0, duration: 56, paused: true,
      ended: false, volume: 1, muted: false, playbackRate: 1, preload: "none",
      textTracks: [{ mode: "disabled" }],
      load: vi.fn(), play: vi.fn(),
    });
    media.load.mockImplementation(() => {
      media.currentTime = 0;
      media.readyState = 0;
      media.paused = true;
      media.playbackRate = 1;
    });
    media.play.mockImplementation(async () => { media.paused = false; });
    return media;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    video = makeVideo();
    loadedTheme = { current: "light" };
    pendingPlayback = { current: null };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function renderTheme(theme: ColorTheme) {
    cleanup?.();
    vi.mocked(useSyncExternalStore).mockReturnValue(theme);
    vi.mocked(useRef)
      .mockReturnValueOnce({ current: video })
      .mockReturnValueOnce(loadedTheme)
      .mockReturnValueOnce(pendingPlayback);
    const html = renderToStaticMarkup(<LandingProductVideo />);
    cleanup = vi.mocked(useEffect).mock.calls.at(-2)![0]() as (() => void) | undefined;
    return html;
  }

  function metadataLoaded() {
    video.readyState = 1;
    video.dispatchEvent(new Event("loadedmetadata"));
  }

  it("selects both matching posters and sources without preloading or autoplaying an unplayed film", () => {
    const light = renderTheme("light");
    expect(light).toContain('src="/media/closespan-demo-v11.mp4"');
    expect(light).toContain('poster="/media/closespan-demo-v11-poster.jpg"');
    expect(video.load).not.toHaveBeenCalled();

    const dark = renderTheme("dark");
    expect(dark).toContain('src="/media/closespan-demo-v12-dark.mp4"');
    expect(dark).toContain('poster="/media/closespan-demo-v12-dark-poster.jpg"');
    expect(video.preload).toBe("none");
    expect(video.play).not.toHaveBeenCalled();
    expect(pendingPlayback.current).toBeNull();
  });

  it("resumes at the same time with the same sound, speed, and captions", () => {
    Object.assign(video, { readyState: 4, currentTime: 18.25, paused: false, volume: 0.4, muted: true, playbackRate: 1.5 });
    video.textTracks[0].mode = "showing";
    renderTheme("dark");
    expect(video.load).toHaveBeenCalledOnce();
    metadataLoaded();
    expect(video).toMatchObject({ currentTime: 18.25, paused: false, volume: 0.4, muted: true, playbackRate: 1.5 });
    expect(video.textTracks[0].mode).toBe("showing");
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("keeps a paused film paused at its existing position", () => {
    Object.assign(video, { readyState: 4, currentTime: 31, paused: true });
    renderTheme("dark");
    expect(video.preload).toBe("auto");
    metadataLoaded();
    expect(video.currentTime).toBe(31);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.preload).toBe("none");
  });

  it("retains the original position when themes change again before metadata arrives", () => {
    Object.assign(video, { readyState: 4, currentTime: 12, paused: false });
    renderTheme("dark");
    renderTheme("light");
    renderTheme("dark");
    metadataLoaded();
    expect(video.currentTime).toBe(12);
    expect(video.paused).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    expect(pendingPlayback.current).toBeNull();
  });

  it("does not resume after unmounting during a source change", () => {
    Object.assign(video, { readyState: 4, currentTime: 7, paused: false });
    renderTheme("dark");
    cleanup?.();
    cleanup = undefined;
    metadataLoaded();
    expect(video.play).not.toHaveBeenCalled();
  });
});
