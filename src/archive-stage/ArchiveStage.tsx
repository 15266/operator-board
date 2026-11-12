import { useEffect, useRef } from "react";
import { ArchiveStageScene, type ArchiveStageMode } from "./scene";
import type { ArchiveCell } from "./loop";
import "./archive-stage.css";

export function ArchiveStage({
  mode,
  cell,
  reduced,
  paused = false,
  onDetailVisibility,
}: {
  mode: ArchiveStageMode;
  cell: ArchiveCell;
  reduced: boolean;
  paused?: boolean;
  onDetailVisibility?: (value: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ArchiveStageScene | null>(null);
  const readyRef = useRef(false);
  const visibilityRef = useRef(onDetailVisibility);
  const propsRef = useRef({ mode, cell, reduced, paused });
  visibilityRef.current = onDetailVisibility;
  propsRef.current = { mode, cell, reduced, paused };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new ArchiveStageScene(host);
    sceneRef.current = scene;
    let lastDocumentEl: HTMLElement | null = null;
    scene.onDetailVisibility = (value) => {
      const parent = host.parentElement;
      parent?.style.setProperty("--ob-detail-visibility", String(value));
      const documentEl = parent?.querySelector<HTMLElement>(".ob-archive-document") ?? null;
      const reducedNow = propsRef.current.reduced;
      const leaving = parent?.classList.contains("is-archive-leaving") ?? false;
      const holdClicks = !reducedNow && (propsRef.current.mode === "detail" || leaving);
      if (lastDocumentEl && lastDocumentEl !== documentEl) lastDocumentEl.inert = false;
      if (documentEl) documentEl.inert = holdClicks && value < 0.1;
      else if (lastDocumentEl) lastDocumentEl.inert = false;
      lastDocumentEl = documentEl;
      visibilityRef.current?.(value);
    };
    const current = propsRef.current;
    scene.setReduced(current.reduced);
    scene.setMode(current.mode, current.reduced);
    scene.selectCell(current.cell, false);
    let cancelled = false;
    void scene.load().then(() => {
      if (cancelled) return;
      const next = propsRef.current;
      scene.setReduced(next.reduced);
      scene.setMode(next.mode, next.reduced);
      scene.selectCell(next.cell, false);
      readyRef.current = true;
      if (!next.paused) scene.start();
    });
    return () => {
      cancelled = true;
      readyRef.current = false;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !readyRef.current) return;
    scene.setReduced(reduced);
    scene.setMode(mode, reduced);
    scene.selectCell(cell, !reduced);
    scene.setPaused(paused);
  }, [mode, cell.lane, cell.row, reduced, paused]);

  return (
    <>
      <div ref={hostRef} className="ob-archive-stage" aria-hidden="true" />
      <div className="ob-archive-shade" aria-hidden="true" />
    </>
  );
}
