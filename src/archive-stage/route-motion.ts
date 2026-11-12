import { createContext } from "react";

/** When true, nested MotionSurface mounts skip their own 300/200ms fade. */
export const SuppressSurfaceMotion = createContext(false);
