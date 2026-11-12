import { useEffect, useRef } from "react";
import {
  CINEMATIC,
  COPY,
  cinematicMotion,
  type CinematicMotion,
} from "../lib/loading-cinematic-motion";
import "./loading-cinematic.css";

const INTRO_FLAG = "ob-loading-cinematic-intro";
const HOLD_SPIN = 0.45;

/** Overlay fade-in. Typewriter in short mode waits for this to finish. */
export const CINEMATIC_ENTER_MS = 600;
/** Overlay fade-out after a skip or the scripted welcome exit. */
export const CINEMATIC_LEAVE_MS = 600;

export type LoadingCinematicProps = {
  /** True while the first-tab boot sequence is still holding (shell not ready, or the initial demo-data fetch on first paint). Later interface scans must not drive this overlay. */
  loading: boolean;
  /** Fires when the leave fade starts, so the shell can drop inert and show through. */
  onLeaving?: () => void;
  onFinished: () => void;
};

function introPlayed(): boolean {
  try {
    return sessionStorage.getItem(INTRO_FLAG) === "1";
  } catch {
    return false;
  }
}

function markIntroPlayed() {
  try {
    sessionStorage.setItem(INTRO_FLAG, "1");
  } catch {
    /* private mode */
  }
}

const arc = (r: number, start: number, sweep: number, x = 960, y = 540) => {
  const point = (a: number) => `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  if (sweep >= Math.PI * 1.999) {
    return `M${point(start)}A${r},${r} 0 1 1 ${point(start + Math.PI)}A${r},${r} 0 1 1 ${point(start + Math.PI * 2)}`;
  }
  return `M${point(start)}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(start + sweep)}`;
};

function setOpacity(el: HTMLElement | SVGElement | null, value: number | boolean) {
  if (!el) return;
  el.style.opacity = String(Number(value));
}

function applyMotion(
  stage: HTMLElement,
  s: CinematicMotion,
  holdSeconds: number,
) {
  const q = <T extends Element>(sel: string) => stage.querySelector<T>(sel);

  setOpacity(q(".lc-access"), s.accessOpacity);
  const access = q<HTMLElement>(".lc-access");
  if (access && access.textContent !== s.access) access.textContent = s.access;

  const mark = q<HTMLElement>(".lc-mark");
  if (mark) {
    setOpacity(mark, s.markOpacity);
    const scale = s.mark.scale;
    mark.style.transform = `translate(${s.mark.offsetX}px, 1px)`;
    const plate = q<HTMLElement>(".lc-mark-plate");
    if (plate) {
      plate.style.opacity = String(s.mark.plateOpacity);
      plate.style.transform = `scale(${scale})`;
    }
  }
  const markName = q<HTMLElement>(".lc-mark-name");
  if (markName && markName.textContent !== s.markLetters) markName.textContent = s.markLetters;
  const markEn = q<HTMLElement>(".lc-mark-en");
  if (markEn && markEn.textContent !== s.markEnglish) markEn.textContent = s.markEnglish;

  setOpacity(q(".lc-auth"), s.authOpacity);
  const auth = q<HTMLElement>(".lc-auth-message");
  if (auth && auth.textContent !== s.auth) auth.textContent = s.auth;

  const brandLines = stage.querySelectorAll<HTMLElement>(".lc-brand-line");
  brandLines.forEach((node, i) => {
    const line = s.brand[i];
    if (!line) return;
    node.style.opacity = String(line.opacity);
    node.style.transform = `translateX(${line.x}px)`;
  });

  const powered = q<HTMLElement>(".lc-powered");
  if (powered) {
    setOpacity(powered, s.poweredLetters > 0);
    powered.style.clipPath = `inset(0 ${100 * (1 - s.poweredLetters / s.poweredCount)}% 0 0)`;
  }

  const scanRoot = q<HTMLElement>(".lc-scan");
  setOpacity(scanRoot, s.scanVisible);
  if (s.scanVisible && scanRoot) renderScan(scanRoot, s, holdSeconds);

  const welcome = q<HTMLElement>(".lc-welcome");
  if (welcome) {
    setOpacity(welcome, s.welcomeVisible ? s.welcomeOpacity : 0);
    welcome.style.transform = "none";
    welcome.style.filter = "none";
  }
  setOpacity(q(".lc-welcome-panel"), s.welcomePanel);
  const heading = q<HTMLElement>(".lc-welcome-heading");
  if (heading) {
    const ink = s.welcomeInk;
    heading.style.color = `color-mix(in srgb, var(--text) ${ink * 100}%, var(--bg))`;
  }
  const company = q<HTMLElement>(".lc-welcome-company");
  if (company) {
    company.style.opacity = String(s.companyVisible ? (s.companyMask ? 0.65 : 1) : 0);
  }
  const companyInk = q<HTMLElement>(".lc-welcome-company-ink span");
  if (companyInk) companyInk.style.opacity = s.companyMask ? ".06" : "1";
  const highlight = q<HTMLElement>(".lc-welcome-highlight");
  if (highlight) highlight.style.clipPath = `inset(0 ${100 * (1 - s.highlight)}% 0 0)`;
  setOpacity(q(".lc-welcome-database"), s.databaseOpacity);
  setOpacity(q(".lc-welcome-mark"), s.welcomeMark);

  setOpacity(q(".lc-background"), s.backgroundOpacity);
  setOpacity(q(".lc-white"), s.white);
  const bgSvg = q<SVGElement>(".lc-background svg");
  if (bgSvg) {
    const drift = s.t + holdSeconds;
    bgSvg.style.transform = `translate(${Math.sin(drift * 0.16) * 18}px, ${-(drift - 6) * 5}px) scale(1.08)`;
  }
}

function renderScan(root: HTMLElement, s: CinematicMotion, holdSeconds: number) {
  const { scan } = s;
  const r = scan.radius;
  const paths = Array.from(root.querySelectorAll<SVGPathElement>("path"));
  const group = paths[0]?.parentElement;
  if (!group) return;
  group.setAttribute(
    "transform",
    `translate(960 540) scale(${s.ringScale}) translate(-960 -540)`,
  );
  group.style.opacity = String(s.ringOpacity);
  group.style.filter = `blur(${s.ringBlur}px)`;
  paths[0]?.setAttribute("d", arc(r, scan.outerStart, scan.outerSweep));
  paths[0]?.setAttribute("stroke-width", "2.4");
  paths[1]?.setAttribute("d", arc(scan.whiteRadius, scan.whiteStart, scan.whiteSweep));
  paths[1]?.setAttribute("stroke-width", "4");
  const inner = scan.innerStart;
  paths[2]?.setAttribute("d", arc(scan.innerRadius, inner, scan.innerSweep));
  paths[3]?.setAttribute("d", arc(scan.innerRadius, inner + Math.PI, scan.innerSweep));

  const spin = holdSeconds * HOLD_SPIN;
  s.scanOrbit.sides.forEach((side, i) => {
    const path = paths[i + 4];
    if (!path) return;
    const start = side.start + (holdSeconds > 0 ? spin * (i === 0 ? 1 : -1) * 0.15 : 0);
    path.setAttribute("d", arc(side.radius, start, side.sweep, side.x, side.y));
    path.style.opacity = s.scanOrbit.sideVisible ? "1" : "0";
  });

  const satellites = Array.from(root.querySelectorAll<SVGCircleElement>(".lc-satellite"));
  const orbitAngle = Math.atan2(
    (s.scanOrbit.satellites[0]?.y ?? 539.5) - 539.5,
    (s.scanOrbit.satellites[0]?.x ?? 959.5) - 959.5,
  );
  const distance = s.scanOrbit.satellites[0]
    ? Math.hypot(s.scanOrbit.satellites[0].x - 959.5, s.scanOrbit.satellites[0].y - 539.5)
    : 0;
  s.scanOrbit.satellites.forEach((point, i) => {
    const dot = satellites[i];
    if (!dot) return;
    const phase = (holdSeconds > 0 ? orbitAngle + spin + (i * Math.PI) / 3 : 0);
    if (holdSeconds > 0) {
      dot.setAttribute("cx", String(959.5 + Math.cos(phase) * distance));
      dot.setAttribute("cy", String(539.5 + Math.sin(phase) * distance));
    } else {
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
    }
    dot.setAttribute("r", String(point.radius));
  });

  const core = root.querySelector<SVGCircleElement>(".lc-scan-core");
  if (core) {
    core.style.opacity = s.ornament ? "1" : "0";
    core.setAttribute("r", String(s.coreRadius));
  }

  const orbit = scan.orbit + spin;
  root.querySelectorAll<SVGCircleElement>(".lc-orbit-dot").forEach((dot, i) => {
    dot.setAttribute("cx", String(960 + Math.cos(orbit + i * Math.PI) * scan.orbitRadius));
    dot.setAttribute("cy", String(540 + Math.sin(orbit + i * Math.PI) * scan.orbitRadius));
    dot.setAttribute("r", String(scan.dotRadius));
  });

  const caps = root.querySelectorAll<SVGCircleElement>(".lc-cap");
  caps.forEach((cap, i) => {
    const angle = i ? scan.whiteStart : scan.outerStart + scan.outerSweep;
    const radius = i ? scan.whiteRadius : r;
    cap.setAttribute("cx", String(960 + Math.cos(angle) * radius));
    cap.setAttribute("cy", String(540 + Math.sin(angle) * radius));
    cap.setAttribute("r", String(i ? scan.whiteCap : scan.blackCap));
  });

  const label = root.querySelector<HTMLElement>(".lc-scan-label");
  if (label) {
    setOpacity(label, s.permissionOpacity);
    label.style.letterSpacing = `${s.scanTracking}px`;
    label.style.fontSize = `${s.scanFont}px`;
  }
}

/**
 * Full-screen boot overlay. Driven by rAF against the ported 25 fps editorial
 * clock. Plays once for the first-tab start sequence. Holds at the
 * processing settle only while the boot `loading` flag is true, then plays
 * the welcome flash and fade/scale-out. Later demo fetches and interface
 * scans do not reopen this overlay; in-page scan feedback uses `.scan-veil`.
 */
export function LoadingCinematic({ loading, onLeaving, onFinished }: LoadingCinematicProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const leavingRef = useRef(onLeaving);
  leavingRef.current = onLeaving;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const short = introPlayed();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stage = root.querySelector<HTMLElement>(".loading-cinematic-stage");
    if (!stage) return;

    let raf = 0;
    let enterRaf = 0;
    let enterTimer = 0;
    let leaveTimer = 0;
    let cancelled = false;
    let finished = false;
    let leaving = false;
    const startAppTime = short ? CINEMATIC.processing : CINEMATIC.veil;
    let startPerf = 0;
    let frozenOrigin: number | null = null;
    let clockStarted = false;

    const finish = () => {
      if (finished || cancelled) return;
      finished = true;
      markIntroPlayed();
      cancelAnimationFrame(raf);
      window.clearTimeout(leaveTimer);
      finishedRef.current();
    };

    const beginLeave = () => {
      if (leaving || finished || cancelled) return;
      leaving = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(enterTimer);
      root.classList.add("is-leaving");
      leavingRef.current?.();
      const opacity = Number(getComputedStyle(root).opacity);
      const duration = opacity < 0.12 ? 200 : CINEMATIC_LEAVE_MS;
      const onEnd = (event: TransitionEvent) => {
        if (event.propertyName !== "opacity") return;
        root.removeEventListener("transitionend", onEnd);
        finish();
      };
      root.addEventListener("transitionend", onEnd);
      leaveTimer = window.setTimeout(finish, duration + 80);
    };

    const tick = (now: number) => {
      if (cancelled || finished || leaving) return;
      let holdSeconds = 0;
      let appTime: number;
      if (frozenOrigin !== null) {
        if (loadingRef.current) {
          appTime = CINEMATIC.hold;
          holdSeconds = (now - frozenOrigin) / 1000;
        } else {
          startPerf += now - frozenOrigin;
          frozenOrigin = null;
          appTime = startAppTime + (now - startPerf) / 1000;
        }
      } else {
        appTime = startAppTime + (now - startPerf) / 1000;
        if (appTime >= CINEMATIC.hold && loadingRef.current) {
          frozenOrigin = now;
          appTime = CINEMATIC.hold;
        }
      }
      const motion = cinematicMotion(appTime);
      applyMotion(stage, motion, holdSeconds);
      if (appTime >= CINEMATIC.exit && !loadingRef.current) {
        beginLeave();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const startClock = () => {
      if (cancelled || finished || leaving || clockStarted) return;
      clockStarted = true;
      startPerf = performance.now();
      raf = requestAnimationFrame(tick);
    };

    // Paint opacity 0 first, then fade the overlay in.
    enterRaf = requestAnimationFrame(() => {
      enterRaf = requestAnimationFrame(() => {
        if (cancelled || leaving) return;
        root.classList.add("is-entered");
      });
    });

    // Hold the first scripted frame under the fade so short mode does not pop on.
    applyMotion(stage, cinematicMotion(startAppTime), 0);
    if (short) {
      enterTimer = window.setTimeout(startClock, CINEMATIC_ENTER_MS);
    } else {
      startClock();
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        beginLeave();
      }
    };
    const onClick = () => beginLeave();
    root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);

    const skip = root.querySelector<HTMLButtonElement>(".lc-skip");
    skip?.focus({ preventScroll: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(enterRaf);
      window.clearTimeout(enterTimer);
      window.clearTimeout(leaveTimer);
      root.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [short]);

  const label = short ? "正在加载" : "系统启动";

  return (
    <div
      ref={rootRef}
      className="loading-cinematic"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="loading-cinematic-stage">
        <div className="lc-background">
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113" />
              <path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130" />
              <circle cx="1450" cy="648" r="346" />
              <circle cx="1450" cy="648" r="348" />
            </g>
          </svg>
          <div className="lc-white" />
        </div>

        <div className="lc-brand" aria-hidden="true">
          {COPY.brand.map((line) => (
            <p key={line} className="lc-brand-line">
              {line}
            </p>
          ))}
        </div>

        <button type="button" className="lc-skip">
          跳过
          <kbd>ESC</kbd>
        </button>

        <div className="lc-access" />

        <div className="lc-mark">
          <span className="lc-mark-plate" aria-hidden="true">
            R
          </span>
          <div className="lc-mark-text">
            <div className="lc-mark-name" />
            <div className="lc-mark-en" />
          </div>
        </div>

        <div className="lc-auth">
          <span className="lc-auth-bullet" aria-hidden="true">
            ▪
          </span>
          <span className="lc-auth-message" />
        </div>

        <div className="lc-scan">
          <svg viewBox="0 0 1920 1080" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path />
              <path className="lc-ring-paper" />
              <path />
              <path />
              <path />
              <path />
              <circle className="lc-orbit-dot" r="8" fill="var(--accent)" stroke="none" />
              <circle className="lc-orbit-dot" r="8" fill="var(--accent)" stroke="none" />
              {Array.from({ length: 6 }, (_, i) => (
                <circle key={i} className="lc-satellite" r="0" fill="currentColor" stroke="none" />
              ))}
              <circle className="lc-scan-core" cx="959.5" cy="539.5" r="5" fill="currentColor" stroke="none" />
              <circle className="lc-cap" r="0" fill="currentColor" stroke="none" />
              <circle className="lc-cap lc-cap-paper" r="0" fill="var(--lc-paper-stroke)" stroke="none" />
            </g>
          </svg>
          <span className="lc-scan-label">{COPY.authorized}</span>
        </div>

        <div className="lc-welcome">
          <div className="lc-welcome-panel" />
          <div className="lc-welcome-heading">{COPY.welcome}</div>
          <div className="lc-welcome-company">
            <strong className="lc-welcome-company-ink">
              <span>{COPY.name}</span>
            </strong>
            <strong className="lc-welcome-highlight" aria-hidden="true">
              {COPY.name}
            </strong>
          </div>
          <div className="lc-welcome-database">{COPY.english}</div>
          <div className="lc-welcome-mark" aria-hidden="true">
            R
          </div>
        </div>

        <div className="lc-powered" aria-hidden="true">
          <b>{COPY.powered}</b>
          <i />
        </div>
      </div>
    </div>
  );
}
