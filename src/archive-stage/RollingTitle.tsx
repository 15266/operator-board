import { useEffect, useRef } from "react";
import { destroyRollingText, rollText } from "./rolling-title";

export function RollingTitle({
  zh,
  en,
  animated,
}: {
  zh: string;
  en: string;
  animated: boolean;
}) {
  const zhRef = useRef<HTMLSpanElement>(null);
  const enRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = zhRef.current;
    if (!el) return;
    rollText(el, zh, animated);
    return () => destroyRollingText(el);
  }, [zh, animated]);

  useEffect(() => {
    const el = enRef.current;
    if (!el) return;
    rollText(el, en, animated);
    return () => destroyRollingText(el);
  }, [en, animated]);

  return (
    <>
      <span ref={zhRef} className="ob-rolling-title" />
      <span ref={enRef} className="title-en ob-rolling-title" />
    </>
  );
}
