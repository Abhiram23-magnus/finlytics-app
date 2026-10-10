// ============================================================
// FINLYTICS — Decorative background video
// ============================================================
// Usage:
//   <video data-bg-video data-src="media/clip.mp4" data-src-webm="media/clip.webm"
//          data-poster="media/clip-poster.jpg"
//          muted autoplay loop playsinline preload="metadata"></video>
//
// Nothing is downloaded while the element is hidden (e.g. by a responsive breakpoint).
// Once visible, the poster is shown, and the video is attached unless the viewer
// asked for reduced motion or has data saver on. The browser picks one source
// (WebM/VP9 first, MP4/H.264 as the fallback), so only one copy is downloaded.
// Playback pauses while the tab is hidden; a failed load falls back to the poster.
'use strict';

(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = () => Boolean(navigator.connection && navigator.connection.saveData);

  function setup(video) {
    const sources = [
      [video.dataset.srcWebm, 'video/webm'],
      [video.dataset.src, 'video/mp4'],
    ].filter(([url]) => url);
    if (!sources.length) return;
    video.muted = true; // required for autoplay; also set before any play() call
    let attached = false;
    let failed = false;

    const isVisible = () => video.getClientRects().length > 0;
    const shouldPlay = () => !failed && !reducedMotion.matches && !saveData() && isVisible();

    function fallBackToPoster() {
      failed = true;
      video.removeAttribute('autoplay');
      video.querySelectorAll('source').forEach(s => s.remove());
      video.load(); // resets to the poster frame
      video.dataset.bgVideoState = 'poster';
    }

    function attach() {
      sources.forEach(([url, type], i) => {
        const source = document.createElement('source');
        source.src = url;
        source.type = type;
        // Only the last source failing means no playable video at all.
        if (i === sources.length - 1) source.addEventListener('error', fallBackToPoster, { once: true });
        video.append(source);
      });
      video.load();
      attached = true;
    }

    function sync() {
      if (isVisible() && video.dataset.poster && !video.poster) video.poster = video.dataset.poster;
      if (shouldPlay() && document.visibilityState === 'visible') {
        if (!attached) attach();
        const p = video.play();
        if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked: poster stays */ });
        video.dataset.bgVideoState = 'playing';
      } else if (attached && !video.paused) {
        video.pause();
        video.dataset.bgVideoState = 'paused';
      }
    }

    video.addEventListener('error', fallBackToPoster);
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', sync);
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(sync, 200); });
    sync();
  }

  document.querySelectorAll('video[data-bg-video]').forEach(setup);
})();
