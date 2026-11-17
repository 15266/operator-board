import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ContentTransition,
  FoldTransition,
  SurfaceTransition,
  beginContentReveal,
  endContentReveal,
  isContentRevealActive,
  markUserNav,
  notifyContentPresented,
  prefersReducedMotion,
} from "../lib/motion";
import { SuppressSurfaceMotion } from "../archive-stage/route-motion";

/**
 * Detail surface: 300ms fade with a 12px lift on enter, 200ms / 8px on exit.
 * `children` receives the exit runner so the back control can animate out
 * before the real route change happens.
 */
export function MotionSurface({
  token,
  className,
  focusable,
  children,
}: {
  token: string;
  className?: string;
  focusable?: boolean;
  children: (exit: (done: () => void) => void) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<SurfaceTransition | null>(null);

  const suppressSurface = useContext(SuppressSurfaceMotion);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const surface = new SurfaceTransition(root, root);
    surfaceRef.current = surface;
    root.hidden = true;
    surface.show(prefersReducedMotion() || isContentRevealActive() || suppressSurface);
    return () => {
      surface.dispose();
      surfaceRef.current = null;
    };
  }, [token]);

  const exit = useCallback((done: () => void) => {
    markUserNav();
    const surface = surfaceRef.current;
    if (!surface) {
      done();
      return;
    }
    surface.hide(prefersReducedMotion(), done);
  }, []);

  return (
    <div
      ref={rootRef}
      className={className}
      tabIndex={focusable ? -1 : undefined}
      data-motion-surface=""
    >
      {children(exit)}
    </div>
  );
}

/**
 * Route/body fade: hold the outgoing page, fade it out (400ms ease-in-out),
 * swap, then fade the incoming page in (400ms ease-in-out). Opacity only.
 * Rapid token changes retarget the in-flight run so only the final view lands.
 * `prefers-reduced-motion` swaps instantly.
 */
export function FadeContent({ token, className, children }: { token: string; className?: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<ContentTransition | null>(null);
  if (!motionRef.current) motionRef.current = new ContentTransition();

  const displayedRef = useRef({ token, node: children });
  const tokenRef = useRef(token);
  const childrenRef = useRef(children);
  tokenRef.current = token;
  childrenRef.current = children;

  const [hold, setHold] = useState<{ token: string; node: ReactNode } | null>(null);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const revealHeldRef = useRef(false);

  const reduced = prefersReducedMotion();

  if (reduced) {
    displayedRef.current = { token, node: children };
  } else if (token !== displayedRef.current.token) {
    if (!hold) {
      setHold({ token: displayedRef.current.token, node: displayedRef.current.node });
      setPhase("out");
    }
  } else if (hold && hold.token === token) {
    setHold(null);
    setPhase("in");
  }

  if (!hold && (reduced || token === displayedRef.current.token) && phase !== "out") {
    displayedRef.current = { token, node: children };
  }

  const node = hold ? hold.node : children;

  useLayoutEffect(() => {
    const el = rootRef.current;
    const motion = motionRef.current;
    if (!el || !motion) return;

    if (reduced) {
      motion.cancel(el);
      el.style.opacity = "1";
      el.removeAttribute("data-view-transition");
      if (revealHeldRef.current) {
        endContentReveal();
        revealHeldRef.current = false;
      }
      notifyContentPresented();
      if (hold || phase !== "idle") {
        setHold(null);
        setPhase("idle");
      }
      return;
    }

    if (phase === "out" && hold) {
      el.setAttribute("data-view-transition", "out");
      motion.fadeOut(el, false, () => {
        if (tokenRef.current === displayedRef.current.token) {
          setHold(null);
          setPhase("in");
          return;
        }
        displayedRef.current = { token: tokenRef.current, node: childrenRef.current };
        el.style.opacity = "0";
        if (!revealHeldRef.current) {
          beginContentReveal();
          revealHeldRef.current = true;
        }
        setHold(null);
        setPhase("in");
      });
      return () => motion.cancel(el);
    }

    if (phase === "in") {
      el.setAttribute("data-view-transition", "in");
      notifyContentPresented();
      motion.fadeIn(el, false, () => {
        el.style.opacity = "1";
        el.removeAttribute("data-view-transition");
        if (revealHeldRef.current) {
          endContentReveal();
          revealHeldRef.current = false;
        }
        if (phaseRef.current === "in") setPhase("idle");
      });
      return () => motion.cancel(el);
    }
  }, [phase, hold, reduced, token]);

  useEffect(() => {
    return () => {
      motionRef.current?.dispose(rootRef.current ?? undefined);
      if (revealHeldRef.current) {
        endContentReveal();
        revealHeldRef.current = false;
      }
    };
  }, []);

  return (
    <div ref={rootRef} className={className}>
      {node}
    </div>
  );
}

/** Rolls a changed counter up into place; unchanged values stay still. */
export function RollingCount({
  value,
  className,
  title,
}: {
  value: number | string;
  className?: string;
  title?: string;
}) {
  const key = String(value);
  return (
    <span className={className ? `motion-count ${className}` : "motion-count"} title={title}>
      <span key={key} className="motion-count-inner">
        {key}
      </span>
    </span>
  );
}

/**
 * Animated disclosure that keeps the native <details> contract (including
 * [open] styles) while the panel uses the surface enter/exit timings.
 */
export function MotionFold({
  className,
  summary,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
}: {
  className?: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isControlled = openProp !== undefined;
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = isControlled ? Boolean(openProp) : uncontrolled;
  const [held, setHeld] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<FoldTransition | null>(null);
  const openRef = useRef(open);
  const skipEnter = useRef(true);
  openRef.current = open;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const fold = new FoldTransition(panel);
    foldRef.current = fold;
    skipEnter.current = true;
    if (!openRef.current) panel.hidden = true;
    return () => {
      fold.dispose();
      foldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const fold = foldRef.current;
    if (!fold) return;
    if (skipEnter.current) {
      skipEnter.current = false;
      setHeld(open);
      return;
    }
    if (open) {
      setHeld(true);
      fold.show(prefersReducedMotion());
    } else {
      fold.hide(prefersReducedMotion(), () => {
        if (!openRef.current) setHeld(false);
      });
    }
  }, [open]);

  function requestOpen(next: boolean) {
    if (!isControlled) setUncontrolled(next);
    onOpenChange?.(next);
  }

  return (
    <details
      className={className}
      open={open || held}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next !== open) requestOpen(next);
      }}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          requestOpen(!open);
        }}
      >
        {summary}
      </summary>
      <div ref={panelRef} className="motion-fold-panel" data-motion-fold="">
        <div className="motion-fold-inner">{children}</div>
      </div>
    </details>
  );
}

/**
 * Height/opacity reveal for panels that are toggled from a sibling control
 * rather than a <details> summary (channel cards, task sections).
 */
export function MotionReveal({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<FoldTransition | null>(null);
  const openRef = useRef(open);
  const skipEnter = useRef(true);
  const [held, setHeld] = useState(open);
  openRef.current = open;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const fold = new FoldTransition(panel);
    foldRef.current = fold;
    skipEnter.current = true;
    if (!openRef.current) panel.hidden = true;
    return () => {
      fold.dispose();
      foldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const fold = foldRef.current;
    if (!fold) return;
    if (skipEnter.current) {
      skipEnter.current = false;
      setHeld(open);
      return;
    }
    if (open) {
      setHeld(true);
      fold.show(prefersReducedMotion());
    } else {
      fold.hide(prefersReducedMotion(), () => {
        if (!openRef.current) setHeld(false);
      });
    }
  }, [open]);

  return (
    <div ref={panelRef} className={className} data-motion-fold="" hidden={!open && !held}>
      {children}
    </div>
  );
}

