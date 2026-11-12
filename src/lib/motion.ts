/**
 * Business motion primitives.
 * Ported from RhineLabUI `src/ui-transitions.ts` (MIT, see logs/rhine-reference-ds),
 * and extended for this board's view switching:
 *
 * - view switch: 400ms ease-in-out fade-out of the outgoing page, then 400ms
 *   ease-in-out fade-in of the incoming page (opacity only). Rapid clicks
 *   retarget in-flight so only the final view lands; they do not queue a stack;
 * - surface (detail) enter: 300ms, panel travels 12px; exit: 200ms, 8px;
 * - reduced motion short-circuits to the final state, never to a half state.
 *
 * The primitives stay framework agnostic; React bindings live in
 * `src/components/Motion.tsx`.
 */

import type { CSSProperties } from "react";

export const MOTION = {
  content: 400,
  surfaceEnter: 300,
  surfaceExit: 200,
  surfaceShift: 12,
  surfaceExitShift: 8,
  stagger: 42,
  staggerCap: 336,
  extract: 220,
  count: 260,
  scanBand: 2400,
} as const;

const enterEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const exitEase = "cubic-bezier(0.4, 0, 1, 1)";

export const ENTER_EASE = enterEase;
export const EXIT_EASE = exitEase;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Per-card wave delay, capped so long lists do not crawl in. */
export function staggerDelay(index: number): number {
  return Math.min(index * MOTION.stagger, MOTION.staggerCap);
}

/** Inline style consumed by `.motion-cards > li` for the wave delay. */
export function waveStyle(index: number): CSSProperties {
  return {
    "--motion-i": String(index),
    "--motion-delay": `${staggerDelay(index)}ms`,
  } as CSSProperties;
}

const contentEase = "ease-in-out";
export const CONTENT_EASE = contentEase;

/**
 * Opacity-only view fade (400ms ease-in-out each way). Every run starts from
 * the current computed opacity so a rapid retarget never jumps or queues.
 * Reduced motion applies the end opacity immediately.
 */
export class ContentTransition {
  private animation?: Animation;
  private revision = 0;

  fadeOut(element: HTMLElement, reduced: boolean, finished?: () => void) {
    this.fadeTo(element, 0, reduced, finished);
  }

  fadeIn(element: HTMLElement, reduced: boolean, finished?: () => void) {
    this.fadeTo(element, 1, reduced, finished);
  }

  fadeTo(element: HTMLElement, target: 0 | 1, reduced: boolean, finished?: () => void) {
    const revision = ++this.revision;
    const from = Number.parseFloat(getComputedStyle(element).opacity || "1");
    if (this.animation) {
      this.animation.cancel();
      this.animation = undefined;
    }
    const done = () => {
      if (revision !== this.revision) return;
      element.style.opacity = String(target);
      this.animation = undefined;
      finished?.();
    };
    if (reduced || Math.abs(from - target) < 0.02) {
      done();
      return;
    }
    element.style.opacity = String(from);
    this.animation = element.animate([{ opacity: from }, { opacity: target }], {
      duration: MOTION.content,
      easing: contentEase,
      fill: "forwards",
    });
    void this.animation.finished.then(done).catch(() => {});
  }

  /** Bake the current opacity into the element style, then cancel in-flight work. */
  cancel(element?: HTMLElement) {
    this.revision++;
    if (element && this.animation) {
      element.style.opacity = getComputedStyle(element).opacity;
    }
    this.animation?.cancel();
    this.animation = undefined;
  }

  finish() {
    this.animation?.finish();
    this.animation = undefined;
  }

  dispose(element?: HTMLElement) {
    this.cancel(element);
  }
}

let contentRevealDepth = 0;

/** True while FadeContent has just swapped in the incoming view and is fading it in. */
export function beginContentReveal() {
  contentRevealDepth++;
}

export function endContentReveal() {
  contentRevealDepth = Math.max(0, contentRevealDepth - 1);
}

export function isContentRevealActive(): boolean {
  return contentRevealDepth > 0;
}

type PresentedFn = () => void;
const presentedListeners = new Set<PresentedFn>();

/** Subscribe to the moment the incoming view is in the DOM (after fade-out, before or as fade-in starts). */
export function onContentPresented(fn: PresentedFn): () => void {
  presentedListeners.add(fn);
  return () => {
    presentedListeners.delete(fn);
  };
}

export function notifyContentPresented() {
  for (const fn of [...presentedListeners]) fn();
}

/**
 * Owns the visible lifetime of a detail surface, including a close that
 * interrupts an opening. Every run bumps a revision; only the latest one is
 * allowed to write the end state, which is what makes double clicks safe.
 */
export class SurfaceTransition {
  private animations: Animation[] = [];
  private revision = 0;
  private root: HTMLElement;
  private panel?: HTMLElement;
  private enterDuration: number;
  private exitDuration: number;

  constructor(root: HTMLElement, panel?: HTMLElement, enterDuration: number = MOTION.surfaceEnter, exitDuration: number = MOTION.surfaceExit) {
    this.root = root;
    this.panel = panel;
    this.enterDuration = enterDuration;
    this.exitDuration = exitDuration;
  }

  show(reduced: boolean) {
    this.run(true, reduced);
  }

  hide(reduced: boolean, finished: () => void = () => {}) {
    this.run(false, reduced, finished);
  }

  finish() {
    this.animations.forEach((animation) => animation.finish());
  }

  dispose() {
    this.revision++;
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }

  private run(show: boolean, reduced: boolean, finished?: () => void) {
    const revision = ++this.revision;
    const hidden = this.root.hidden;
    const opacity = hidden ? "0" : getComputedStyle(this.root).opacity;
    const transform = this.panel
      ? hidden
        ? `translateY(${MOTION.surfaceShift}px)`
        : getComputedStyle(this.panel).transform
      : undefined;
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.root.hidden = false;
    this.root.dataset.transition = show ? "opening" : "closing";
    const complete = () => {
      if (revision !== this.revision) return;
      this.root.hidden = !show;
      this.root.dataset.transition = show ? "open" : "closed";
      this.animations.forEach((animation) => animation.cancel());
      this.animations = [];
      finished?.();
    };
    if (reduced) {
      complete();
      return;
    }
    const options: KeyframeAnimationOptions = {
      duration: show ? this.enterDuration : this.exitDuration,
      easing: show ? enterEase : exitEase,
      fill: "both",
    };
    const fade = this.root.animate([{ opacity }, { opacity: show ? 1 : 0 }], options);
    this.animations.push(fade);
    if (this.panel) {
      this.animations.push(
        this.panel.animate(
          [
            { transform },
            {
              transform: show
                ? "translateY(0)"
                : `translateY(${MOTION.surfaceExitShift}px)`,
            },
          ],
          options,
        ),
      );
    }
    void fade.finished.then(complete).catch(() => {});
  }
}

let userNav = false;

/** Marks the next surface mount as the result of a click/keyboard choice. */
export function markUserNav() {
  userNav = true;
}

/** Reads and clears the flag, so focus is only moved for real navigations. */
export function consumeUserNav(): boolean {
  const value = userNav;
  userNav = false;
  return value;
}

/**
 * Card "extraction" feedback: the chosen card lifts out of the grid before the
 * board switches. Reduced motion (or a missing element) navigates immediately.
 */
let extractGeneration = 0;

/**
 * Card "extraction" feedback: the chosen card lifts out of the grid before the
 * board switches. Reduced motion (or a missing element) navigates immediately.
 * A later click cancels the previous extraction so only the last choice commits.
 */
export function extractCard(element: HTMLElement | null, done: () => void) {
  const generation = ++extractGeneration;
  const commit = () => {
    if (generation !== extractGeneration) return;
    done();
  };
  if (!element || prefersReducedMotion()) {
    commit();
    return;
  }
  element.classList.add("is-extracting");
  const animation = element.animate(
    [
      { transform: "translateY(0) scale(1)", opacity: 1 },
      { transform: "translateY(-7px) scale(1.012)", opacity: 1, offset: 0.55 },
      { transform: "translateY(-14px) scale(1.006)", opacity: 0.42 },
    ],
    { duration: MOTION.extract, easing: enterEase, fill: "both" },
  );
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    element.classList.remove("is-extracting");
    animation.cancel();
    commit();
  };
  void animation.finished.then(finish).catch(finish);
  window.setTimeout(finish, MOTION.extract + 120);
}

/**
 * Disclosure open/close with the surface timing contract. Height is retargeted
 * from the current computed size so rapid toggles never jump through a half
 * state. Reduced motion applies the end state immediately.
 */
export class FoldTransition {
  private animations: Animation[] = [];
  private revision = 0;
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  show(reduced: boolean) {
    this.run(true, reduced);
  }

  hide(reduced: boolean, finished: () => void = () => {}) {
    this.run(false, reduced, finished);
  }

  finish() {
    this.animations.forEach((animation) => animation.finish());
  }

  dispose() {
    this.revision++;
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }

  private run(show: boolean, reduced: boolean, finished?: () => void) {
    const revision = ++this.revision;
    const root = this.root;
    const computed = getComputedStyle(root);
    const fromHeight = root.hidden ? 0 : root.getBoundingClientRect().height;
    const fromOpacity = root.hidden ? "0" : computed.opacity;
    const fromTransform = root.hidden
      ? `translateY(${MOTION.surfaceShift}px)`
      : computed.transform === "none"
        ? "translateY(0px)"
        : computed.transform;

    root.style.height = `${fromHeight}px`;
    root.style.opacity = fromOpacity;
    root.style.overflow = "hidden";
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    root.hidden = false;
    root.dataset.transition = show ? "opening" : "closing";
    root.style.height = "auto";
    const fullHeight = root.scrollHeight;
    root.style.height = `${fromHeight}px`;
    const targetHeight = show ? fullHeight : 0;

    const complete = () => {
      if (revision !== this.revision) return;
      this.animations.forEach((animation) => animation.cancel());
      this.animations = [];
      root.style.height = show ? "auto" : "";
      root.style.opacity = show ? "" : "";
      root.style.transform = "";
      root.style.overflow = show ? "" : "hidden";
      root.hidden = !show;
      root.dataset.transition = show ? "open" : "closed";
      finished?.();
    };

    if (reduced) {
      complete();
      return;
    }

    const options: KeyframeAnimationOptions = {
      duration: show ? MOTION.surfaceEnter : MOTION.surfaceExit,
      easing: show ? enterEase : exitEase,
      fill: "both",
    };
    const animation = root.animate(
      [
        {
          height: `${fromHeight}px`,
          opacity: fromOpacity,
          transform: fromTransform,
        },
        {
          height: `${targetHeight}px`,
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0px)" : `translateY(${MOTION.surfaceExitShift}px)`,
        },
      ],
      options,
    );
    this.animations.push(animation);
    void animation.finished.then(complete).catch(() => {});
  }
}
