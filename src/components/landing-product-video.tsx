"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_COLOR_THEME, type ColorTheme } from "@/lib/color-theme";
import { resolveColorTheme, THEME_CHANGE_EVENT } from "@/lib/color-theme-client";
import styles from "./landing-product-video.module.css";

const demos = {
  light: { video: "/media/closespan-demo-v11.mp4", poster: "/media/closespan-demo-v11-poster.jpg" },
  dark: { video: "/media/closespan-demo-v12-dark.mp4", poster: "/media/closespan-demo-v12-dark-poster.jpg" },
};

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}

function serverTheme(): ColorTheme {
  return DEFAULT_COLOR_THEME;
}

type PlaybackSnapshot = {
  time: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  captions: TextTrackMode | undefined;
};

export function LandingProductVideo() {
  const theme = useSyncExternalStore(subscribeToTheme, resolveColorTheme, serverTheme);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const loadedTheme = useRef(theme);
  const pendingPlayback = useRef<PlaybackSnapshot | null>(null);
  const { video: videoSrc, poster } = demos[theme];

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loadedTheme.current === theme) return;
    loadedTheme.current = theme;

    // Keep the same element, including focus and native player settings. A new
    // <source> needs load(); retain the original position across rapid toggles.
    const playback = pendingPlayback.current ?? {
      time: video.ended ? 0 : video.currentTime,
      playing: !video.paused && !video.ended,
      volume: video.volume,
      muted: video.muted,
      rate: video.playbackRate,
      captions: video.textTracks[0]?.mode,
    };
    if (!pendingPlayback.current && video.readyState === 0 && !playback.playing && playback.time === 0) {
      video.load();
      return;
    }

    pendingPlayback.current = playback;
    let cancelled = false;
    async function restorePlayback() {
      if (!video || cancelled) return;
      video.currentTime = Math.min(playback.time, video.duration);
      video.volume = playback.volume;
      video.muted = playback.muted;
      video.playbackRate = playback.rate;
      if (video.textTracks[0] && playback.captions) video.textTracks[0].mode = playback.captions;
      pendingPlayback.current = null;
      video.preload = "none";
      if (playback.playing) {
        try {
          await video.play();
        } catch (error) {
          if (!cancelled && !(error instanceof Error && error.name === "AbortError")) setPlaybackError(true);
        }
      }
    }

    video.addEventListener("loadedmetadata", restorePlayback, { once: true });
    // A previously viewed, paused video also needs metadata to restore its seek.
    video.preload = "auto";
    video.load();
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", restorePlayback);
    };
  }, [theme]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;
      observer.disconnect();
      if (!video.paused || video.currentTime > 0) return;
      // Muted playback can start without a user gesture. Leave the button
      // available if the browser blocks autoplay, and never override a pause.
      video.muted = true;
      void video.play().catch(() => {});
    }, { threshold: 0.35 });

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  async function playDemo() {
    const video = videoRef.current;
    if (!video) return;

    setPlaybackError(false);
    try {
      video.muted = false;
      await video.play();
      video.focus();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setPlaybackError(true);
    }
  }

  return (
    <div className={styles.frame}>
      <div className={styles.stage} data-video-theme={theme}>
        <video
          ref={videoRef}
          className={styles.video}
          aria-label="CloseSpan product demo, 56 seconds"
          aria-describedby="product-demo-caption"
          width={1920}
          height={1080}
          poster={poster}
          preload="none"
          controls
          muted
          playsInline
          tabIndex={0}
          onPlay={() => { setHasStarted(true); setPlaybackError(false); }}
          onLoadStart={() => setPlaybackError(false)}
          onEnded={() => setHasStarted(false)}
          onError={() => setPlaybackError(true)}
        >
          <source src={videoSrc} type="video/mp4" />
          <track kind="captions" src="/media/closespan-demo-v11.en.vtt" srcLang="en" label="English" />
          <a href={videoSrc}>Watch the CloseSpan product demo</a>
        </video>
        {!hasStarted && !playbackError ? (
          <button
            type="button"
            className={styles.playButton}
            onClick={playDemo}
            aria-label="Take a look at the demo"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7Z" fill="currentColor" /></svg>
            <span>Take a look</span>
          </button>
        ) : null}
      </div>
      {playbackError ? (
        <p className={styles.error} role="alert">
          Having trouble playing? <a href={videoSrc}>Open the video directly</a>.
        </p>
      ) : null}
      <noscript><p className={styles.error}><a href={videoSrc}>Watch the CloseSpan product demo</a></p></noscript>
    </div>
  );
}
