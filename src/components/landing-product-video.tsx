"use client";

import { useRef, useState } from "react";
import styles from "./landing-product-video.module.css";

const videoSrc = "/media/closespan-demo-v11.mp4";

export function LandingProductVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);

  async function playDemo() {
    const video = videoRef.current;
    if (!video) return;

    setPlaybackError(false);
    try {
      await video.play();
      video.focus();
    } catch {
      setPlaybackError(true);
    }
  }

  return (
    <div className={styles.frame}>
      <div className={styles.stage}>
        <video
          ref={videoRef}
          className={styles.video}
          aria-label="CloseSpan product demo, 56 seconds"
          aria-describedby="product-demo-caption"
          width={1920}
          height={1080}
          poster="/media/closespan-demo-v11-poster.jpg"
          preload="none"
          controls
          playsInline
          tabIndex={0}
          onPlay={() => { setHasStarted(true); setPlaybackError(false); }}
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
            aria-label="Play the CloseSpan demo with sound, 56 seconds"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7Z" fill="currentColor" /></svg>
            <span>Watch the demo<small>56 seconds · With sound</small></span>
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
