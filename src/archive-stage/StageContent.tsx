import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ContentTransition,
  SurfaceTransition,
  beginContentReveal,
  endContentReveal,
  notifyContentPresented,
} from "../lib/motion";
import { SuppressSurfaceMotion } from "./route-motion";

export type RouteKind = "browse" | "detail" | "other";

const DETAIL_MS = 180;
/** Swap to the browse list once the cassette has mostly returned. */
const EXIT_VISIBILITY = 0.28;
const EXIT_FALLBACK_MS = 720;

function readDetailVisibility(from: HTMLElement | null): number {
  if (!from) return 1;
  const raw = Number.parseFloat(
    getComputedStyle(from).getPropertyValue("--ob-detail-visibility") || "1",
  );
  return Number.isFinite(raw) ? raw : 1;
}

export function StageContent({
  token,
  kind,
  reduced,
  className,
  children,
}: {
  token: string;
  kind: RouteKind;
  reduced: boolean;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<SurfaceTransition | null>(null);
  const fadeRef = useRef<ContentTransition | null>(null);
  if (!fadeRef.current) fadeRef.current = new ContentTransition();

  const displayedRef = useRef({ token, kind, node: children });
  const tokenRef = useRef(token);
  const kindRef = useRef(kind);
  const childrenRef = useRef(children);
  tokenRef.current = token;
  kindRef.current = kind;
  childrenRef.current = children;

  const [hold, setHold] = useState<{ token: string; kind: RouteKind; node: ReactNode } | null>(null);
  const [phase, setPhase] = useState<"idle" | "out" | "in" | "detail-exit">("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const revealHeldRef = useRef(false);
  const leaving = Boolean(hold && hold.kind === "detail");

  if (reduced) {
    displayedRef.current = { token, kind, node: children };
  } else if (token !== displayedRef.current.token) {
    const from = displayedRef.current.kind;
    const to = kind;
    if (!hold) {
      if (from === "detail") {
        setHold({ token: displayedRef.current.token, kind: from, node: displayedRef.current.node });
        setPhase("detail-exit");
      } else if (to === "other" || from === "other") {
        setHold({ token: displayedRef.current.token, kind: from, node: displayedRef.current.node });
        setPhase("out");
      } else {
        displayedRef.current = { token, kind, node: children };
        if (to === "detail" && phase !== "in") setPhase("in");
      }
    }
  } else if (hold && hold.token === token) {
    setHold(null);
    setPhase("in");
  }

  if (!hold && (reduced || token === displayedRef.current.token) && phase !== "out" && phase !== "detail-exit") {
    displayedRef.current = { token, kind, node: children };
  }

  const node = hold ? hold.node : children;
  const shownKind = hold ? hold.kind : kind;
  const documentLayer = shownKind === "detail";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const surface = new SurfaceTransition(root, root, DETAIL_MS, DETAIL_MS);
    surfaceRef.current = surface;
    return () => {
      surface.dispose();
      surfaceRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    const fade = fadeRef.current;
    const surface = surfaceRef.current;
    if (!el || !fade) return;

    if (reduced) {
      fade.cancel(el);
      surface?.finish();
      el.style.opacity = "1";
      el.style.translate = "0 0";
      el.removeAttribute("data-view-transition");
      el.inert = false;
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

    if (phase === "detail-exit" && hold) {
      el.setAttribute("data-view-transition", "detail-out");
      // Keep the document on screen and let --ob-detail-visibility (camera /
      // cassette return) fade it out. Do not run the 180ms surface hide, which
      // used to clear the document and leave a right-shifted empty column.
      el.style.opacity = "";
      el.style.translate = "";
      el.hidden = false;
      el.inert = false;
      const workspace = el.closest(".workspace");
      let cancelled = false;
      let frame = 0;
      const started = performance.now();
      const finish = () => {
        if (cancelled) return;
        displayedRef.current = {
          token: tokenRef.current,
          kind: kindRef.current,
          node: childrenRef.current,
        };
        el.style.opacity = "0";
        if (!revealHeldRef.current) {
          beginContentReveal();
          revealHeldRef.current = true;
        }
        setHold(null);
        setPhase("in");
      };
      const tick = () => {
        if (cancelled) return;
        const vis = readDetailVisibility(workspace instanceof HTMLElement ? workspace : null);
        if (vis <= EXIT_VISIBILITY || performance.now() - started >= EXIT_FALLBACK_MS) {
          finish();
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }

    if (phase === "out" && hold) {
      el.setAttribute("data-view-transition", "out");
      fade.fadeOut(el, false, () => {
        if (tokenRef.current === displayedRef.current.token) {
          setHold(null);
          setPhase("in");
          return;
        }
        displayedRef.current = { token: tokenRef.current, kind: kindRef.current, node: childrenRef.current };
        el.style.opacity = "0";
        if (!revealHeldRef.current) {
          beginContentReveal();
          revealHeldRef.current = true;
        }
        setHold(null);
        setPhase("in");
      });
      return () => fade.cancel(el);
    }

    if (phase === "in") {
      notifyContentPresented();
      const nextKind = kindRef.current;
      el.hidden = false;
      if (nextKind === "detail") {
        // Opacity and travel are driven by --ob-detail-visibility, in step
        // with the extracted cassette. A separate 180ms show would fight it.
        // Do not leave data-view-transition on: that rule disables clicks
        // (selects, inputs, buttons) for the whole detail document.
        el.removeAttribute("data-view-transition");
        el.style.translate = "";
        el.style.opacity = "";
        el.hidden = false;
        el.inert = false;
        surface?.finish();
        if (revealHeldRef.current) {
          endContentReveal();
          revealHeldRef.current = false;
        }
        if (phaseRef.current === "in") setPhase("idle");
        return;
      }
      el.setAttribute("data-view-transition", "in");
      fade.fadeIn(el, false, () => {
        el.style.opacity = "1";
        el.removeAttribute("data-view-transition");
        if (revealHeldRef.current) {
          endContentReveal();
          revealHeldRef.current = false;
        }
        if (phaseRef.current === "in") setPhase("idle");
      });
      return () => fade.cancel(el);
    }

    if (phase === "idle") {
      el.removeAttribute("data-view-transition");
      el.inert = false;
      if (innerRef.current && shownKind !== "detail") innerRef.current.inert = false;
      if (shownKind === "browse") {
        el.style.opacity = "1";
        el.style.translate = "0 0";
      }
    }
  }, [phase, hold, reduced, token, shownKind]);

  useEffect(() => {
    const inner = innerRef.current;
    if (inner && !documentLayer) inner.inert = false;
  }, [documentLayer, phase, token]);

  useEffect(() => {
    const workspace = rootRef.current?.closest(".workspace");
    workspace?.classList.toggle("is-archive-leaving", leaving);
    return () => {
      workspace?.classList.remove("is-archive-leaving");
    };
  }, [leaving]);

  useEffect(() => {
    return () => {
      fadeRef.current?.dispose(rootRef.current ?? undefined);
      surfaceRef.current?.dispose();
      if (revealHeldRef.current) {
        endContentReveal();
        revealHeldRef.current = false;
      }
    };
  }, []);

  return (
    <SuppressSurfaceMotion.Provider value={documentLayer}>
      <div ref={rootRef} className={className}>
        <div ref={innerRef} className={documentLayer ? "ob-archive-document" : undefined}>
          {node}
        </div>
      </div>
    </SuppressSurfaceMotion.Provider>
  );
}
