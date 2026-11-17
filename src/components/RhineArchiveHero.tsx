import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ScannerBoardView } from "../lib/scannerBoard";
import "./rhine-motion.css";

const AUTOPLAY_MS = 5200;
const PULSE_MS = 260;

interface RhinelSlide {
  src: string;
  title: string;
  meta: string;
  caption: string;
}

/** 只用参考仓库 docs/media 下的真实截图，不生成、不合成任何图像。 */
const SLIDES: RhinelSlide[] = [
  {
    src: "/rhine/archive.jpg",
    title: "档案循环阵列",
    meta: "ARCHIVE ARRAY",
    caption: "循环档案导航与索引栅格。",
  },
  {
    src: "/rhine/detail.jpg",
    title: "解密后内构",
    meta: "DECRYPTED CORE",
    caption: "双环结构解密完成后的档案概述。",
  },
  {
    src: "/rhine/research.jpg",
    title: "研究记录",
    meta: "RESEARCH LOG",
    caption: "研究记录页签与条目排布。",
  },
  {
    src: "/rhine/assembly.jpg",
    title: "结构拆解",
    meta: "ASSEMBLY VIEW",
    caption: "六组结构拆解视图。",
  },
  {
    src: "/rhine/search.jpg",
    title: "档案索引",
    meta: "INDEX SEARCH",
    caption: "按关键词检索后的档案索引。",
  },
  {
    src: "/rhine/viewer-frosted.jpg",
    title: "磨砂查看器",
    meta: "FROSTED VIEWER",
    caption: "同一视角下的磨砂玻璃状态。",
  },
  {
    src: "/rhine/viewer-clear.jpg",
    title: "清晰查看器",
    meta: "CLEAR VIEWER",
    caption: "独立查看器，清晰玻璃状态。",
  },
  {
    src: "/rhine/settings.jpg",
    title: "偏好设置",
    meta: "PREFERENCES",
    caption: "音效、画质与减少动态效果开关。",
  },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 只描述扫描器的真实扫描态，不推断任何连通性。 */
function scanStatus(board: ScannerBoardView): { text: string; tone: "scanning" | "idle" | "done" | "example" } {
  if (board.scanning) return { text: "正在扫描本机常见端口", tone: "scanning" };
  if (board.example) return { text: "示例数据 · 非实机扫描", tone: "example" };
  if (!board.scanned) return { text: "尚未扫描", tone: "idle" };
  const { discovered, total } = board.summary;
  return { text: `上次扫描完成 · 有应答 ${discovered} / 共 ${total}`, tone: "done" };
}

export function RhineArchiveHero({ board }: { board: ScannerBoardView }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pulse, setPulse] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const status = scanStatus(board);

  const goTo = useCallback((next: number) => {
    setIndex(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
  }, []);

  // 自动轮播：可暂停、悬停/聚焦即停、页面不可见时不切换、减少动效时不启动。
  useEffect(() => {
    if (!playing || hovering || focused || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((current) => (current + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [playing, hovering, focused, reducedMotion]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    },
    [],
  );

  const resetParallax = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--rhine-px", "0");
    stage.style.setProperty("--rhine-py", "0");
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (reducedMotion || event.pointerType === "touch") return;
      const stage = stageRef.current;
      if (!stage || rafRef.current !== null) return;
      const { clientX, clientY } = event;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (clientX - rect.left) / rect.width - 0.5;
        const y = (clientY - rect.top) / rect.height - 0.5;
        stage.style.setProperty("--rhine-px", x.toFixed(3));
        stage.style.setProperty("--rhine-py", y.toFixed(3));
      });
    },
    [reducedMotion],
  );

  const onPointerLeave = useCallback(() => {
    setHovering(false);
    resetParallax();
  }, [resetParallax]);

  const onStageKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goTo(SLIDES.length - 1);
      }
    },
    [goTo, index],
  );

  const onStageClick = useCallback(() => {
    setPulse(true);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse(false), PULSE_MS);
    // 点击画面推进一帧，作为明确的“下一张”反馈。
    goTo(index + 1);
  }, [goTo, index]);

  const slide = SLIDES[index];

  return (
    <section
      className="rhine-hero"
      aria-labelledby="rhine-hero-title"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="rhine-hero-head">
        <div className="rhine-hero-heading">
          <p className="rhine-kicker">
            <span className="rhine-kicker-mark" aria-hidden="true" />
            RHINE ARCHIVE / REFERENCE VISUAL
          </p>
          <h2 id="rhine-hero-title">莱茵档案馆 · 参考视觉</h2>
          <p className="rhine-hero-sub">
            宽幅科研档案版式参考自 RhineLabUI（MIT），图像为参考仓库的真实截图；<strong>不代表本机任何接口已连通</strong>，
            扫描状态只读自本页扫描器数据。
          </p>
        </div>
        <div className="rhine-hero-tools">
          <span className={`rhine-scan-chip tone-${status.tone}`} aria-live="polite">
            <span className="rhine-scan-dot" aria-hidden="true" />
            {status.text}
          </span>
          <button
            type="button"
            className="rhine-toggle"
            onClick={() => setPlaying((value) => !value)}
            aria-pressed={!playing}
          >
            {playing ? "暂停轮播" : "继续轮播"}
          </button>
        </div>
      </div>

      <div className="rhine-hero-body">
        <div
          ref={stageRef}
          className={`rhine-stage${pulse ? " is-pulsing" : ""}${board.scanning ? " is-scanning" : ""}`}
          role="group"
          aria-roledescription="档案图像轮播"
          aria-label={`${slide.title}（第 ${index + 1} / ${SLIDES.length} 张）`}
          tabIndex={0}
          onKeyDown={onStageKeyDown}
          onPointerMove={onPointerMove}
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={onPointerLeave}
          onBlur={resetParallax}
          onClick={onStageClick}
        >
          <div className="rhine-stage-grid" aria-hidden="true" />
          {SLIDES.map((item, i) => (
            <figure
              key={item.src}
              className={`rhine-frame${i === index ? " is-active" : ""}`}
              aria-hidden={i === index ? undefined : true}
            >
              <img src={item.src} alt={`参考界面截图：${item.title}`} draggable={false} decoding="async" />
            </figure>
          ))}
          <div className="rhine-stage-sheen" aria-hidden="true" />
          <div className="rhine-scanline" aria-hidden="true" />
          <figcaption className="rhine-caption">
            <div key={slide.src} className="rhine-caption-copy">
              <span className="rhine-caption-meta">{slide.meta}</span>
              <strong>{slide.title}</strong>
              <span>{slide.caption}</span>
            </div>
          </figcaption>
          <div className="rhine-stage-count" aria-hidden="true">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <span className="rhine-stage-count-divider">/</span>
            <span>{String(SLIDES.length).padStart(2, "0")}</span>
          </div>
        </div>

        <ul className="rhine-thumbs" aria-label="参考图像">
          {SLIDES.map((item, i) => (
            <li key={item.src} style={{ "--rhine-i": i } as CSSProperties}>
              <button
                type="button"
                className={`rhine-thumb${i === index ? " is-active" : ""}`}
                onClick={() => goTo(i)}
                aria-pressed={i === index}
                aria-label={`显示 ${item.title}`}
              >
                <span className="rhine-thumb-index" aria-hidden="true">
                  A-{String(i + 1).padStart(2, "0")}
                </span>
                <img src={item.src} alt="" loading="lazy" draggable={false} decoding="async" />
                <span className="rhine-thumb-title">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="rhine-hero-foot">
        左 / 右方向键切换 · 点击画面推进一张 · 悬停或聚焦时暂停轮播 · 已遵循系统「减少动态效果」
        <span aria-hidden="true"> · </span>
        素材与许可见 <code>public/rhine/SOURCES.md</code>（
        <a href="https://github.com/LBEILC/RhineLabUI" target="_blank" rel="noreferrer">
          LBEILC / RhineLabUI
        </a>
        ，MIT），无声音资源。
      </p>
    </section>
  );
}
