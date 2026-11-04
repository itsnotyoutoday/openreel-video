import { useEffect, useRef, type ReactElement } from "react";

/**
 * A tab or glyph icon from the host: an image URL, or a short text glyph.
 * Nothing is rendered as HTML.
 */
export function HostIcon({
  icon,
  size = 18,
  fallback,
}: {
  icon?: string;
  size?: number;
  fallback: ReactElement;
}): ReactElement {
  if (!icon) return fallback;
  if (/^(https?:|data:image\/|blob:|\/|\.\/)/.test(icon)) {
    return <img src={icon} alt="" width={size} height={size} className="object-contain" aria-hidden />;
  }
  return (
    <span aria-hidden className="leading-none" style={{ fontSize: size - 2 }}>
      {icon.slice(0, 2)}
    </span>
  );
}

/**
 * Hands a container element to host code and tears it down on unmount. A host
 * that throws is logged and shown as a short message; the editor goes on.
 */
export function HostMount({
  mount,
  label,
  className,
}: {
  mount: (el: HTMLElement) => () => void;
  label: string;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mount);
  mountRef.current = mount;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let teardown: (() => void) | undefined;
    try {
      teardown = mountRef.current(el);
    } catch (error) {
      console.error(`[OpenReel] Host panel "${label}" failed to mount:`, error);
      el.textContent = `${label} could not be loaded.`;
    }
    return () => {
      try {
        teardown?.();
      } catch (error) {
        console.error(`[OpenReel] Host panel "${label}" failed to unmount:`, error);
      }
      el.replaceChildren();
    };
  }, [label]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      data-openreel-host-panel
      className={className}
    />
  );
}
