/**
 * The still behind a placeholder clip: what the preview and an export draw
 * when the clip is on screen. Drawn synchronously on a canvas, so a placeholder
 * can be added without waiting for any media import.
 */

export interface PlaceholderCardOptions {
  readonly label?: string;
  readonly pattern: "bars" | "hatch";
  readonly width: number;
  readonly height: number;
  /** A decoded still to fill the card with (cover). */
  readonly image?: HTMLImageElement;
}

// 1x1 neutral grey, used where a canvas is unavailable (tests, headless).
const FALLBACK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Fit `text` on one line by trimming; the card is a visual cue, not layout. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** A PNG data URL for the card. */
export function renderPlaceholderCard(options: PlaceholderCardOptions): string {
  if (typeof document === "undefined") return FALLBACK_PNG;
  const width = Math.max(2, Math.round(options.width));
  const height = Math.max(2, Math.round(options.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return FALLBACK_PNG;

  ctx.fillStyle = "#1c1d22";
  ctx.fillRect(0, 0, width, height);

  if (options.image) {
    const source = options.image;
    const sw = Number(source.width ?? width) || width;
    const sh = Number(source.height ?? height) || height;
    const scale = Math.max(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#2a2c34";
    if (options.pattern === "bars") {
      const bar = Math.max(8, Math.round(width / 24));
      for (let x = 0; x < width; x += bar * 2) ctx.fillRect(x, 0, bar, height);
    } else {
      ctx.strokeStyle = "#2a2c34";
      ctx.lineWidth = Math.max(2, Math.round(width / 200));
      const step = Math.max(14, Math.round(width / 40));
      for (let x = -height; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x + height, 0);
        ctx.stroke();
      }
    }
    if (options.label) {
      const size = Math.max(14, Math.round(Math.min(width, height) / 12));
      ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const text = fitText(ctx, options.label, width * 0.8);
      const metrics = ctx.measureText(text);
      const padX = size;
      const padY = size * 0.7;
      ctx.fillStyle = "rgba(16,17,21,0.82)";
      ctx.fillRect(
        (width - metrics.width) / 2 - padX,
        height / 2 - size / 2 - padY,
        metrics.width + padX * 2,
        size + padY * 2,
      );
      ctx.fillStyle = "#e8e9ee";
      ctx.fillText(text, width / 2, height / 2);
    }
  }
  try {
    const url: string | null = canvas.toDataURL("image/png");
    return url?.startsWith("data:") ? url : FALLBACK_PNG;
  } catch {
    return FALLBACK_PNG;
  }
}

/** Decode a data URL into bytes without a network round trip. */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma);
  const type = meta.split(";")[0] || "image/png";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

/** Load a still from a URL; resolves `null` when it cannot be loaded or drawn. */
export function loadStill(
  url: string,
  crossOrigin: "anonymous" | "use-credentials" | null = "anonymous",
): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // data: and blob: URLs never need CORS; a host can turn it off for its own URLs with `null`
    if (crossOrigin && !/^(data|blob):/.test(url)) image.crossOrigin = crossOrigin;
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
