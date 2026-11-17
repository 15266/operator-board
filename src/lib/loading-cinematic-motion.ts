/**
 * Frame clock and typography beats for the loading cinematic.
 * Motion math follows RhineLabUI `src/boot-motion.ts` (MIT, Copyright (c) 2026 LBEILC).
 * App time zero corresponds to source video time 5 s; discrete cuts use 25 fps
 * frame numbers. Copy is retargeted to the operator board — no Rhine Lab marks.
 */
import { brandTrack, companyTrack, markTrack, scanTrack, track } from "./loading-cinematic-tracks";
import { scanOrbitTrack } from "./loading-cinematic-orbit";

export const progress = (t: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (t - a) / (b - a)));
export const smooth = (p: number) => p * p * (3 - 2 * p);

/** Soft join for major beats — 180ms, not a 1-frame cut. */
const BEAT_FADE = 0.18;
const fadeGate = (t: number, inAt: number, outAt: number, fade = BEAT_FADE) =>
  smooth(progress(t, inAt, inAt + fade)) * (1 - smooth(progress(t, outAt, outAt + fade)));

const typed = (text: string, f: number, start: number, end: number) =>
  text.slice(
    0,
    f < start
      ? 0
      : Math.min(
          text.length,
          1 + Math.floor(((f - start) * (text.length - 1)) / (end - start)),
        ),
  );
const at = (f: number, frames: number[]) => frames.includes(f);

/** Access line uses the same 170–187 frame window as the source typewriter. */
const ACCESS = "OPERATOR ACCESS REQUIRED";

/** Clock anchors in app time (source video seconds minus 5). */
export const CINEMATIC = {
  /** Veil is up; first letter follows 600 ms later. */
  veil: 1.16,
  firstLetter: 1.76,
  /** START PROCESSING begins at source frame 421. */
  processing: 11.84,
  /** Last scan frame before the welcome flash (source 568 / 22.72 s). */
  hold: 17.72,
  welcome: 17.76,
  /** Welcome script ends (source 26.92 s); overlay fade follows in the component. */
  exit: 21.92,
  /** Welcome scale/blur handoff length, in source-video seconds. */
  welcomeExitStart: 26.02,
  welcomeExitEnd: 26.92,
} as const;

export const COPY = {
  access: ACCESS,
  session: "SESSION CONFIRMED",
  request: "REQUEST RECEIVED",
  processing: "START PROCESSING",
  authorized: "TERMINAL AUTHORIZED",
  welcome: "WELCOME TO",
  name: "圆桌会议",
  english: "ROUNDTABLE",
  brand: ["圆桌会议", "Roundtable", "OPERATOR BOARD"] as const,
  powered: "OPERATOR BOARD",
} as const;

const POWERED_LEN = COPY.powered.length;

export function cinematicMotion(appTime: number) {
  const t = appTime + 5;
  const f = Math.floor(t * 25 + 0.00001);
  const step =
    t < 9.12
      ? "access"
      : t < 11.12
        ? "logo"
        : t < 19.48
          ? "auth"
          : t < 22.76
            ? "scan"
            : "welcome";
  let auth = "";
  if (f < 363) {
    auth = typed(COPY.session, f, 282, 295);
  } else if (f < 421) {
    auth = typed(COPY.request, f, 367, 389);
  } else {
    auth = typed(COPY.processing, f, 423, 440);
    if (f >= 449) auth += ".".repeat(Math.min(3, 1 + Math.floor((f - 449) / 4)));
    if (at(f, [479, 485, 486])) auth = "              SING...";
  }
  const frame = t * 25;
  const scan = scanTrack(frame);
  const scanOrbit = scanOrbitTrack(frame);
  const scanGlitch = at(f, [525, 526, 528, 529]);
  const welcomeIntro = [1, 0, 0.28, 0, 1, 0, 0];
  const flashIndex = f - 569;
  const exit = smooth(progress(t, CINEMATIC.welcomeExitStart, CINEMATIC.welcomeExitEnd));
  return {
    t,
    f,
    step,
    auth,
    access: typed(COPY.access, f, 170, 187),
    accessOpacity: fadeGate(t, 6.8, 9.08),
    markOpacity: fadeGate(t, 9.16, 19.48),
    mark: markTrack(frame),
    markLetters: typed(COPY.name, f, 232, 255),
    markEnglish: typed("ROUNDTABLE", f, 236, 255),
    authOpacity: fadeGate(t, 11.24, 19.48),
    brand: [0, 1, 2].map((line) => brandTrack(frame, line)),
    poweredLetters: typed(COPY.powered, f, 279, 295).length,
    poweredCount: POWERED_LEN,
    scanVisible: fadeGate(t, 19.48, 22.76),
    scan,
    scanOrbit,
    ringScale: scanGlitch ? 1.94 : 1,
    ringOpacity: scanGlitch
      ? 0.32
      : track(
          [
            [487, 0],
            [488, 0.18],
            [490, 0.6],
            [493, 1],
          ],
          frame,
        ),
    ringBlur: scanGlitch ? 2.2 : 0,
    scanTracking: track(
      [
        [487, 40],
        [492, 28],
        [497, 18],
        [500, 14],
        [505, 8],
        [510, 4],
        [515, 1.7],
        [520, 0.5],
        [527, 0],
        [568, 0],
      ],
      frame,
    ),
    scanFont: 26.5,
    permissionOpacity:
      t < 21.8
        ? progress(t, 19.48, 19.88)
        : track(
            [
              [545, 1],
              [546, 0.4],
              [547, 0.3],
              [548, 0.25],
              [549, 0.1],
              [550, 0.04],
              [551, 0],
            ],
            frame,
          ),
    ornament: t >= 21.84,
    coreRadius: scanOrbit.coreRadius,
    welcomeVisible: t >= 22.76 && t < CINEMATIC.welcomeExitEnd,
    welcomePanel:
      flashIndex >= 0 && flashIndex < 7 ? welcomeIntro[flashIndex] : 0,
    welcomeInk:
      flashIndex >= 0 && flashIndex < 7
        ? [0, 0, 0.2, 1, 0, 0, 0.25][flashIndex]
        : 1,
    companyVisible: f >= 588 && !at(f, [590, 591]),
    companyMask: at(f, [594, 595]),
    highlight: companyTrack(frame),
    databaseOpacity: f < 626 || at(f, [628, 629, 631, 634]) ? 0 : 1,
    welcomeMark: f >= 588,
    welcomeScale: 1,
    welcomeOpacity: 1 - exit,
    exitBlur: 0,
    exit,
    backgroundOpacity: 1,
    white: 0,
  };
}

export type CinematicMotion = ReturnType<typeof cinematicMotion>;
