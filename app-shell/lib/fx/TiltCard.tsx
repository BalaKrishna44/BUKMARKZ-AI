'use client';
import {
  createContext, useCallback, useContext, useEffect, useRef,
  type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode,
} from 'react';

/**
 * TiltCard: cursor-following 3D tilt with a moving light sheen.
 *
 * Design notes
 *  - Zero React re-renders while the pointer moves. Pointer events write a target; one rAF loop eases the
 *    current values toward it and sets CSS variables on the element (compositor-only: transform + opacity).
 *  - The loop sleeps as soon as the card has settled, so idle cards cost nothing.
 *  - Mouse and pen only. Touch scrolling is never hijacked. Disabled for prefers-reduced-motion.
 *  - Children sit in a preserve-3d layer: wrap anything in <TiltDepth z={30}> to make it float above the card.
 *  - Tailwind classes style the shell; the dynamic values come from CSS variables.
 */

export interface TiltCardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children?: ReactNode;
  as?: ElementType;
  /** Max rotation in degrees at the card edge. */
  maxTilt?: number;
  /** Scale while hovered. */
  scale?: number;
  /** CSS perspective in px (smaller = more dramatic). */
  perspective?: number;
  /** Show the moving sheen. */
  glare?: boolean;
  /** Sheen strength, 0 to 1. */
  glareOpacity?: number;
  /** Sheen colour. */
  glareColor?: string;
  /** Easing speed, 0.05 (floaty) to 0.4 (snappy). */
  ease?: number;
  /** Default: the card faces the cursor (the corner under the pointer dips away). `invert` makes that corner rise toward the viewer instead. */
  invert?: boolean;
  disabled?: boolean;
}

const Ctx = createContext(false);

/** Lifts its children `z` px off the card plane. Only has an effect inside a TiltCard. */
export function TiltDepth({ z = 20, className = '', style, children, ...rest }: HTMLAttributes<HTMLDivElement> & { z?: number }) {
  const inside = useContext(Ctx);
  return (
    <div className={className} style={{ transform: inside ? `translateZ(${z}px)` : undefined, ...style }} {...rest}>
      {children}
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export default function TiltCard({
  children, as, maxTilt = 10, scale = 1.03, perspective = 900, glare = true, glareOpacity = 0.28,
  glareColor = '255,255,255', ease = 0.14, invert = false, disabled = false,
  className = '', style, onPointerEnter, onPointerMove, onPointerLeave, ...rest
}: TiltCardProps) {
  const Tag = (as ?? 'div') as ElementType;
  const el = useRef<HTMLElement | null>(null);
  const rect = useRef<DOMRect | null>(null);
  const raf = useRef(0);
  // current and target state: rotation (deg), pointer position (0..1), hover amount (0..1)
  const cur = useRef({ rx: 0, ry: 0, mx: 0.5, my: 0.5, h: 0 });
  const tgt = useRef({ rx: 0, ry: 0, mx: 0.5, my: 0.5, h: 0 });
  const motionOk = useRef(true);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { motionOk.current = !mq.matches; };
    sync(); mq.addEventListener('change', sync);
    return () => { mq.removeEventListener('change', sync); cancelAnimationFrame(raf.current); };
  }, []);

  const paint = useCallback(() => {
    const n = el.current; if (!n) return;
    const c = cur.current;
    n.style.setProperty('--tilt-rx', `${c.rx.toFixed(3)}deg`);
    n.style.setProperty('--tilt-ry', `${c.ry.toFixed(3)}deg`);
    n.style.setProperty('--tilt-s', (1 + (scale - 1) * c.h).toFixed(4));
    n.style.setProperty('--tilt-mx', `${(c.mx * 100).toFixed(2)}%`);
    n.style.setProperty('--tilt-my', `${(c.my * 100).toFixed(2)}%`);
    n.style.setProperty('--tilt-glare', (c.h * glareOpacity).toFixed(4));
  }, [scale, glareOpacity]);

  const tick = useCallback(() => {
    const c = cur.current, t = tgt.current;
    let moving = false;
    for (const k of ['rx', 'ry', 'mx', 'my', 'h'] as const) {
      const d = t[k] - c[k];
      if (Math.abs(d) > 0.001) { c[k] += d * ease; moving = true; } else c[k] = t[k];
    }
    paint();
    raf.current = moving ? requestAnimationFrame(tick) : 0;
  }, [ease, paint]);

  const wake = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(tick); }, [tick]);

  const active = (e: React.PointerEvent) => !disabled && motionOk.current && e.pointerType !== 'touch';

  return (
    <Ctx.Provider value>
      <Tag
        ref={el}
        {...rest}
        onPointerEnter={(e: React.PointerEvent<HTMLElement>) => {
          onPointerEnter?.(e as never);
          if (!active(e)) return;
          rect.current = e.currentTarget.getBoundingClientRect();     // measured once per hover, not per move
          tgt.current.h = 1; wake();
        }}
        onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
          onPointerMove?.(e as never);
          if (!active(e)) return;
          const r = rect.current ?? (rect.current = e.currentTarget.getBoundingClientRect());
          const x = clamp((e.clientX - r.left) / r.width, 0, 1);
          const y = clamp((e.clientY - r.top) / r.height, 0, 1);
          const s = invert ? -1 : 1;
          tgt.current.ry = (x - 0.5) * 2 * maxTilt * s;               // left/right edge -> rotateY
          tgt.current.rx = -(y - 0.5) * 2 * maxTilt * s;              // top/bottom edge -> rotateX
          tgt.current.mx = x; tgt.current.my = y; tgt.current.h = 1;
          wake();
        }}
        onPointerLeave={(e: React.PointerEvent<HTMLElement>) => {
          onPointerLeave?.(e as never);
          rect.current = null;
          Object.assign(tgt.current, { rx: 0, ry: 0, h: 0 });          // ease back flat; sheen fades out in place
          wake();
        }}
        className={`group/tilt relative isolate [transform-style:preserve-3d] will-change-transform ${className}`}
        style={{
          transform: `perspective(${perspective}px) rotateX(var(--tilt-rx,0deg)) rotateY(var(--tilt-ry,0deg)) scale(var(--tilt-s,1))`,
          ...style,
        } as CSSProperties}
      >
        {children}
        {glare && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] mix-blend-soft-light [transform:translateZ(1px)]"
            style={{
              opacity: 'var(--tilt-glare,0)',
              background: `radial-gradient(circle at var(--tilt-mx,50%) var(--tilt-my,50%), rgba(${glareColor},1) 0%, rgba(${glareColor},0.35) 28%, rgba(${glareColor},0) 60%)`,
            }}
          />
        )}
        {glare && (
          // soft specular edge: a thin highlight that slides opposite to the cursor, like light catching a bevel
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit]"
            style={{
              opacity: 'calc(var(--tilt-glare,0) * 1.4)',
              background: `linear-gradient(115deg, transparent calc(var(--tilt-mx,50%) - 22%), rgba(${glareColor},0.18) var(--tilt-mx,50%), transparent calc(var(--tilt-mx,50%) + 22%))`,
              mixBlendMode: 'overlay',
            }}
          />
        )}
      </Tag>
    </Ctx.Provider>
  );
}
