import type { Application } from 'pixi.js';

/** Render directly at the fitted physical display size, avoiding CSS resampling.
 * The scene still uses its original logical coordinates (including hit testing).
 */
export function fitPixelCanvas(app: Application, host: HTMLElement, width: number, height: number): () => void {
  const canvas = app.canvas;
  let stopped = false;
  let frame = 0;
  let densityQuery: MediaQueryList | undefined;
  const update = () => {
    if (stopped || !canvas.isConnected) return;
    const density = window.devicePixelRatio || 1;
    const desktop = window.matchMedia('(min-width: 1180px)').matches;
    const availableWidth = host.clientWidth;
    const availableHeight = desktop ? Math.min(host.clientHeight, 760) : availableWidth * height / width;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    // Fit continuously: rounding the sprite scale down made a nearly 2x scene
    // collapse to 1x. Nearest texture sampling still preserves hard contours.
    const resolution = Math.min(availableWidth / width, availableHeight / height) * density;
    app.renderer.resize(width, height, resolution);
    canvas.style.setProperty('width', `${canvas.width / density}px`, 'important');
    canvas.style.setProperty('height', `${canvas.height / density}px`, 'important');
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('image-rendering', 'pixelated', 'important');
    canvas.style.flexShrink = '0';
    // Browser zoom and moving the window between monitors can change DPR
    // without changing the host's CSS dimensions.
    densityQuery?.removeEventListener('change', schedule);
    densityQuery = window.matchMedia(`(resolution: ${density}dppx)`);
    densityQuery.addEventListener('change', schedule);
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  window.addEventListener('resize', schedule);
  update();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    densityQuery?.removeEventListener('change', schedule);
  };
}
