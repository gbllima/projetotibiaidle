import type { Application } from 'pixi.js';

/**
 * Keep pixel-art scenes sharp while still fitting the available viewport.
 *
 * Important distinction:
 * - Pixi renders at an integer backing-store resolution, so sprites/floor edges
 *   never land on fractional framebuffer pixels.
 * - The browser performs the final visual fit using nearest-neighbour CSS
 *   scaling (`image-rendering: pixelated`).
 *
 * This is intentionally different from rendering Pixi itself at a fractional
 * resolution, which makes moving sprites and tiles look softer even when their
 * textures use nearest sampling.
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

    const fit = Math.min(availableWidth / width, availableHeight / height);

    // Never ask WebGL to rasterize at a fractional resolution. On fractional
    // DPR displays use the next integer backing resolution and let the browser
    // downsample with nearest-neighbour pixel-art rules.
    const backingResolution = Math.max(1, Math.ceil(density));

    // Preserve the current responsive size. Only the backing store changes;
    // the CSS box still occupies the same fitted dimensions as before.
    let cssWidth = Math.max(1, Math.round(width * fit));
    let cssHeight = Math.max(1, Math.round(height * fit));

    // Flex centering can otherwise place the canvas on a half CSS pixel when
    // host/canvas parity differs, softening every sprite and label at once.
    if ((availableWidth - cssWidth) % 2 !== 0 && cssWidth > 1) cssWidth -= 1;
    if ((Math.round(availableHeight) - cssHeight) % 2 !== 0 && cssHeight > 1) cssHeight -= 1;

    app.renderer.resize(width, height, backingResolution);

    canvas.style.setProperty('width', `${cssWidth}px`, 'important');
    canvas.style.setProperty('height', `${cssHeight}px`, 'important');
    canvas.style.setProperty('max-width', 'none', 'important');
    canvas.style.setProperty('max-height', 'none', 'important');
    canvas.style.setProperty('image-rendering', 'pixelated', 'important');
    canvas.style.removeProperty('transform');
    canvas.style.setProperty('backface-visibility', 'hidden', 'important');
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
