/**
 * Rolling workspace titles, using @kitlangton/rolling-number the same way
 * RhineLabUI `src/workbench-rolling.ts` does (MIT, Copyright (c) 2026 LBEILC).
 */
import { createRollingText } from "@kitlangton/rolling-number";

const controllers = new WeakMap<HTMLElement, ReturnType<typeof createRollingText>>();

export function rollText(element: HTMLElement, text: string, animated: boolean) {
  const previous = controllers.get(element);
  if (previous) {
    previous.destroy();
    controllers.delete(element);
  }
  element.replaceChildren();
  const controller = createRollingText(element, {
    text,
    duration: 460,
    motionBlur: true,
    transition: "direct",
    stagger: "none",
    direction: "up",
    animated,
  });
  controllers.set(element, controller);
  if (!animated) controller.finish();
}

export function destroyRollingText(element: HTMLElement) {
  const controller = controllers.get(element);
  if (!controller) {
    element.replaceChildren();
    return;
  }
  controller.destroy();
  controllers.delete(element);
  element.replaceChildren();
}
