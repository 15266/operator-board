import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BRIDGE_EXECUTORS, fetchSeedPlan, useBridge } from "./lib/bridge";
import { INTERFACE_STATUS_LABEL, useScannerBoard } from "./lib/scannerBoard";
import { hashWantsExample, LocalInterfacesBoard } from "./components/LocalInterfacesBoard";
import type { ExternalChannel, Project } from "./lib/types";
import {
  ChannelsBoard,
  loadRegisteredChannels,
  persistRegisteredChannels,
} from "./components/ChannelsBoard";
import {
  ProjectsBoard,
  ensureProjectRoles,
  loadProjects,
  persistProjects,
} from "./components/ProjectsBoard";
import { createArthurSampleProject, fillArthurSampleBlanks, SAMPLE_ARTHUR_PROJECT_ID } from "./lib/sampleArthurProject";
import { mergeExecutorChannels } from "./lib/localExecutors";
import { useKbProjectsSnapshot } from "./lib/kbSnapshot";
import { ACTION, FOOTNOTE, NAV_SECTION, PROJECT_COPY, VIEW_TITLE } from "./lib/copy";
import { GlossaryButton } from "./components/Glossary";
import { ThemeToggle } from "./components/ThemeToggle";
import { ArchiveText } from "./components/ArchiveText";
import { RoundtableMark } from "./components/RoundtableMark";
import { RollingCount } from "./components/Motion";
import { LoadingCinematic } from "./components/LoadingCinematic";
import { markUserNav, prefersReducedMotion } from "./lib/motion";
import { RollingTitle } from "./archive-stage/RollingTitle";
import { StageContent, type RouteKind } from "./archive-stage/StageContent";
import type { ArchiveCell } from "./archive-stage/loop";

const ArchiveStage = lazy(() =>
  import("./archive-stage/ArchiveStage").then((module) => ({ default: module.ArchiveStage })),
);

const PRIMARY_NAV = [
  { id: "projects", href: "#projects", label: "任务" },
  { id: "channels", href: "#channels", label: "通道" },
  { id: "interfaces", href: "#interfaces", label: "本机接口" },
] as const;

const NAV = PRIMARY_NAV;

type ViewId = (typeof NAV)[number]["id"];

const RETIRED_HASHES = new Set([
  "current-work",
  "board-title",
  "overview",
  "dispatch",
  "brief",
  "queue",
  "evidence",
  "audit",
  "codex",
  "roles",
]);

const HASH_TO_VIEW: Record<string, ViewId> = {
  "": "projects",
  projects: "projects",
  channels: "channels",
  interfaces: "interfaces",
};

const STAGE_LANES: Record<ViewId, number> = {
  projects: 2,
  channels: 3,
  interfaces: 4,
};

function routeKind(
  view: ViewId,
  selectedProjectId: string | null,
  createProjectRequested: boolean,
  selectedInterfaceId: string | null,
): RouteKind {
  if (view === "projects" && selectedProjectId && !createProjectRequested) return "detail";
  if (view === "interfaces" && selectedInterfaceId) return "detail";
  return "browse";
}

function stageCell(
  view: ViewId,
  kind: RouteKind,
  selectedProjectId: string | null,
  selectedInterfaceId: string | null,
  createProjectRequested: boolean,
): ArchiveCell {
  const lane = STAGE_LANES[view] ?? 2;
  if (kind !== "detail") return { lane, row: 12 };
  const key = `${view}:${selectedProjectId ?? selectedInterfaceId ?? ""}:${createProjectRequested ? "create" : ""}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return { lane, row: 8 + (hash % 16) };
}


function hashPath(hash: string): string {
  return hash.replace(/^#/, "").split("?")[0];
}

function viewFromHash(hash: string): ViewId {
  const id = hashPath(hash).split("/")[0];
  return HASH_TO_VIEW[id] ?? "projects";
}

function isRetiredHash(hash: string): boolean {
  const id = hashPath(hash).split("/")[0];
  return !id || RETIRED_HASHES.has(id);
}

function projectIdFromHash(hash: string): string | null {
  const raw = hashPath(hash);
  if (!raw.startsWith("projects/")) return null;
  const id = raw.slice("projects/".length).trim();
  return id || null;
}

function interfaceIdFromHash(hash: string): string | null {
  const raw = hashPath(hash);
  if (!raw.startsWith("interfaces/")) return null;
  const id = raw.slice("interfaces/".length).trim();
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export default function App() {
  const [registered, setRegistered] = useState<ExternalChannel[]>(() =>
    typeof window === "undefined" ? [] : loadRegisteredChannels(),
  );
  const [projects, setProjects] = useState<Project[]>(() =>
    typeof window === "undefined" ? [] : loadProjects(),
  );
  // Mirror projects to the KB tree (POST /bridge/kb/projects/snapshot, secrets stripped, silent retries).
  useKbProjectsSnapshot(projects);
  const [view, setView] = useState<ViewId>(() =>
    typeof window === "undefined" ? "projects" : viewFromHash(window.location.hash),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return projectIdFromHash(window.location.hash);
  });
  const [createProjectRequested, setCreateProjectRequested] = useState(false);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return interfaceIdFromHash(window.location.hash);
  });
  const [forceExample, setForceExample] = useState(() =>
    typeof window === "undefined" ? false : hashWantsExample(window.location.hash),
  );
  const bridge = useBridge();

  useEffect(() => {
    setProjects((prev) => {
      if (prev.some((p) => p.project_id === SAMPLE_ARTHUR_PROJECT_ID)) return prev;
      const next = [ensureProjectRoles(createArthurSampleProject()), ...prev];
      persistProjects(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Seed the AI dispatch test plan (bridge/test-plan.json) as a board project once.
    void fetchSeedPlan().then((plan) => {
      if (!plan) return;
      setProjects((prev) => {
        if (prev.some((p) => p.project_id === plan.project.project_id)) return prev;
        const next = [
          ...prev,
          ensureProjectRoles({
            project_id: plan.project.project_id,
            name: plan.project.name,
            notes: plan.project.notes,
            created_at: new Date().toISOString(),
            tasks: plan.tasks.map((t) => ({ ...t, created_at: new Date().toISOString() })),
          }),
        ];
        persistProjects(next);
        return next;
      });
    });
  }, []);
  const [navOpen, setNavOpen] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [cinematicOpen, setCinematicOpen] = useState(() =>
    typeof window === "undefined" ? false : !prefersReducedMotion(),
  );
  const [cinematicLeaving, setCinematicLeaving] = useState(false);
  // Once the first-tab boot overlay has closed (or been skipped), later
  // demo fetches and interface scans must not reopen it.
  const bootCinematicDone = useRef(false);

  useEffect(() => {
    function onHashChange() {
      if (isRetiredHash(window.location.hash)) {
        window.history.replaceState(null, "", "#projects");
      }
      const nextView = viewFromHash(window.location.hash);
      setView(nextView);
      setForceExample(hashWantsExample(window.location.hash));
      if (nextView === "projects") {
        setSelectedProjectId(projectIdFromHash(window.location.hash));
      } else {
        setCreateProjectRequested(false);
      }
      if (nextView === "interfaces") {
        setSelectedInterfaceId(interfaceIdFromHash(window.location.hash));
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    setNavOpen(false);
  }, [view, selectedProjectId, selectedInterfaceId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (projects.some((project) => project.project_id === selectedProjectId)) return;
    setCreateProjectRequested(false);
    setSelectedProjectId(null);
    if (window.location.hash !== "#projects") {
      window.history.replaceState(null, "", "#projects");
    }
    setView("projects");
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      window.location.hash === ""
      || window.location.hash === "#"
      || isRetiredHash(window.location.hash)
    ) {
      window.history.replaceState(null, "", "#projects");
    }
  }, []);

  useEffect(() => {
    setShellReady(true);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);


  const channels = registered;
  const extraRegisteredIds = useMemo(
    () => channels.map((c) => c.id).filter(Boolean),
    [channels],
  );
  const scannerBoard = useScannerBoard({
    autoScan: true,
    discovery: bridge.discover,
    forceExample,
    extraRegisteredIds,
  });
  const executorChannels = useMemo(
    () => mergeExecutorChannels(registered, scannerBoard.rows),
    [registered, scannerBoard.rows],
  );
  const detectedDispatchIds = useMemo(
    () => executorChannels.map((channel) => channel.id).filter((id) => BRIDGE_EXECUTORS.has(id)),
    [executorChannels],
  );

  useEffect(() => {
    if (detectedDispatchIds.length === 0) return;
    setProjects((prev) => {
      const index = prev.findIndex((project) => project.project_id === SAMPLE_ARTHUR_PROJECT_ID);
      if (index < 0) return prev;
      const filled = fillArthurSampleBlanks(prev[index], detectedDispatchIds);
      if (filled === prev[index]) return prev;
      const next = [...prev];
      next[index] = ensureProjectRoles(filled);
      persistProjects(next);
      return next;
    });
  }, [detectedDispatchIds]);

  function registerChannel(channel: ExternalChannel) {
    setRegistered((prev) => {
      const next = [...prev, channel];
      persistRegisteredChannels(next);
      return next;
    });
  }

  function removeChannel(id: string) {
    setRegistered((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistRegisteredChannels(next);
      return next;
    });
  }

  function commitProjects(next: Project[]) {
    persistProjects(next);
    setProjects(next);
  }

  function goToProjects(projectId?: string | null, create = false) {
    setCreateProjectRequested(create);
    setSelectedProjectId(projectId ?? null);
    const hash = projectId ? `#projects/${projectId}` : "#projects";
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      setView("projects");
    }
  }

  function handleSelectProject(id: string | null) {
    setCreateProjectRequested(false);
    setSelectedProjectId(id);
    const hash = id ? `#projects/${id}` : "#projects";
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
    setView("projects");
  }

  function handleSelectInterface(id: string | null) {
    setSelectedInterfaceId(id);
    const hash = id ? `#interfaces/${encodeURIComponent(id)}` : "#interfaces";
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
    setView("interfaces");
  }

  function goToInterfaces(interfaceId?: string | null) {
    handleSelectInterface(interfaceId ?? null);
    if (window.location.hash === (interfaceId ? `#interfaces/${encodeURIComponent(interfaceId)}` : "#interfaces")) {
      setView("interfaces");
    }
  }

  const title = VIEW_TITLE[view];
  const kind = routeKind(view, selectedProjectId, createProjectRequested, selectedInterfaceId);
  const cell = useMemo(
    () => stageCell(view, kind, selectedProjectId, selectedInterfaceId, createProjectRequested),
    [view, kind, selectedProjectId, selectedInterfaceId, createProjectRequested],
  );
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window === "undefined" ? false : prefersReducedMotion(),
  );

  // Boot overlay only: first paint. Interface auto-scan and manual
  // "扫描本机常见端口" use the in-page .scan-veil, not this cinematic.
  const cinematicLoading = !shellReady;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (cinematicLoading && !cinematicOpen && !bootCinematicDone.current) {
      setCinematicOpen(true);
    }
  }, [cinematicLoading, cinematicOpen]);

  return (
    <>
      {cinematicOpen ? (
        <LoadingCinematic
          loading={cinematicLoading}
          onLeaving={() => setCinematicLeaving(true)}
          onFinished={() => {
            bootCinematicDone.current = true;
            setCinematicOpen(false);
            setCinematicLeaving(false);
          }}
        />
      ) : null}
    <div
      className="app-shell"
      inert={(cinematicOpen && !cinematicLeaving) || undefined}
      aria-hidden={(cinematicOpen && !cinematicLeaving) || undefined}
    >
      {navOpen ? (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside className={`sidebar ${navOpen ? "is-open" : ""}`} aria-label="操作台导航">
        <a className="sidebar-brand" href="#projects">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span className="sidebar-brand-text">
            圆桌会议
            <span className="title-en">Roundtable</span>
          </span>
        </a>

        <div className="sidebar-scroll">
          <div className="sidebar-primary">
            <button
              type="button"
              className="sidebar-create"
              onClick={() => {
                markUserNav();
                goToProjects(null, true);
              }}
            >
              <ArchiveText zh={ACTION.newProject.zh} en={ACTION.newProject.en} />
            </button>

            <p className="sidebar-label sidebar-label-roundtable">
              <RoundtableMark />
              <ArchiveText zh={NAV_SECTION.projectArchive.zh} en={NAV_SECTION.projectArchive.en} />
            </p>
            <nav className="sidebar-nav" aria-label={PROJECT_COPY.sidebarListAria}>
              <a
                href="#projects"
                className={
                  view === "projects" && !selectedProjectId && !createProjectRequested
                    ? "is-active"
                    : undefined
                }
                onClick={(e) => {
                  e.preventDefault();
                  markUserNav();
                  goToProjects(null);
                }}
              >
                <span className="sidebar-item-label">
                  <ArchiveText zh={ACTION.allProjects.zh} en={ACTION.allProjects.en} />
                </span>
              </a>
              {projects.length === 0 ? (
                <p className="sidebar-empty">{PROJECT_COPY.sidebarEmpty}</p>
              ) : (
                projects.map((project) => (
                  <a
                    key={project.project_id}
                    href={`#projects/${project.project_id}`}
                    className={
                      view === "projects" && selectedProjectId === project.project_id
                        ? "is-active"
                        : undefined
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      markUserNav();
                      goToProjects(project.project_id);
                    }}
                  >
                    <span className="sidebar-item-label">
                      <span className="sidebar-item-main">
                        <RoundtableMark />
                        <span className="sidebar-item-name">{project.name}</span>
                      </span>
                    </span>
                    <RollingCount
                      className="sidebar-item-meta"
                      value={project.tasks.filter((t) => !t.parent_task_id).length}
                      title={
                        project.tasks.length === 0
                          ? "还没有任务"
                          : `总任务 ${project.tasks.filter((t) => !t.parent_task_id).length} 条，含分工共 ${project.tasks.length} 条`
                      }
                    />
                  </a>
                ))
              )}
            </nav>

            <p className="sidebar-label">
              <ArchiveText zh={NAV_SECTION.channelIndex.zh} en={NAV_SECTION.channelIndex.en} />
            </p>
            <nav className="sidebar-nav" aria-label="通道">
              <a
                href="#channels"
                className={view === "channels" ? "is-active" : undefined}
                onClick={() => markUserNav()}
              >
                <span className="sidebar-item-label">
                  <ArchiveText zh={ACTION.allChannels.zh} en={ACTION.allChannels.en} />
                </span>
                <RollingCount className="sidebar-item-meta" value={channels.length} />
              </a>
            </nav>

            <p className="sidebar-label">
              <ArchiveText zh={NAV_SECTION.interfaceIndex.zh} en={NAV_SECTION.interfaceIndex.en} />
            </p>
            <nav className="sidebar-nav" aria-label="本机接口">
              <a
                href="#interfaces"
                className={view === "interfaces" && !selectedInterfaceId ? "is-active" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  markUserNav();
                  goToInterfaces(null);
                }}
              >
                <span className="sidebar-item-label">
                  <ArchiveText zh={ACTION.allInterfaces.zh} en={ACTION.allInterfaces.en} />
                </span>
                <RollingCount className="sidebar-item-meta" value={scannerBoard.rows.length} />
              </a>
              {scannerBoard.rows.length === 0 ? (
                <p className="sidebar-empty">
                  {scannerBoard.example
                    ? "示例未加载"
                    : scannerBoard.catalogAvailability === "missing_route"
                      ? "桥接未提供扫描接口"
                      : scannerBoard.catalogAvailability === "offline"
                        ? "桥接未接通"
                        : "尚未扫描"}
                </p>
              ) : (
                scannerBoard.rows.map((row) => (
                  <a
                    key={row.scanner_id}
                    href={`#interfaces/${encodeURIComponent(row.scanner_id)}`}
                    className={
                      view === "interfaces" && selectedInterfaceId === row.scanner_id ? "is-active" : undefined
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      markUserNav();
                      goToInterfaces(row.scanner_id);
                    }}
                  >
                    <span className="sidebar-item-label">{row.display_name}</span>
                    <span className="sidebar-item-meta">
                      {INTERFACE_STATUS_LABEL[row.uiStatus].text}
                    </span>
                  </a>
                ))
              )}
            </nav>
          </div>

        </div>

        <div className="sidebar-foot">
          <ThemeToggle />
          <GlossaryButton />
        </div>
      </aside>

      <div className={`workspace ${kind === "detail" ? "is-archive-detail" : "is-archive-browse"}`}>
        <Suspense fallback={null}>
          <ArchiveStage
            mode={kind === "detail" ? "detail" : "browse"}
            cell={cell}
            reduced={reducedMotion}
            paused={cinematicOpen && !cinematicLeaving}
          />
        </Suspense>
        <header className="workspace-bar">
          <button
            type="button"
            className="icon-btn nav-toggle"
            aria-expanded={navOpen}
            aria-label={navOpen ? "关闭导航" : "打开导航"}
            onClick={() => setNavOpen((open) => !open)}
          >
            <ArchiveText zh={ACTION.menu.zh} en={ACTION.menu.en} />
          </button>
          <div className="workspace-bar-titles">
            <h1>
              <RollingTitle zh={title.zh} en={title.en} animated={!reducedMotion} />
            </h1>
          </div>
        </header>

        <div className={`workspace-body ${view === "projects" || view === "interfaces" ? "is-workspace" : ""}`}>
          <StageContent
            token={`${view}:${view === "projects" ? selectedProjectId ?? (createProjectRequested ? "create" : "list") : ""}:${view === "interfaces" ? selectedInterfaceId ?? "list" : ""}`}
            kind={kind}
            reduced={reducedMotion}
            className="route-body"
          >
          {view === "projects" ? (
            <ProjectsBoard
              projects={projects}
              channels={executorChannels}
              onChange={commitProjects}
              selectedProjectId={selectedProjectId}
              onSelectProject={handleSelectProject}
              createRequested={createProjectRequested}
              onCreateHandled={() => setCreateProjectRequested(false)}
              bridge={bridge}
              scannerBoard={scannerBoard}
            />
          ) : null}

          {view === "channels" ? (
            <ChannelsBoard
              channels={channels}
              onRegister={registerChannel}
              onRemove={removeChannel}
              bridge={bridge}
            />
          ) : null}

          {view === "interfaces" ? (
            <LocalInterfacesBoard
              board={scannerBoard}
              selectedId={selectedInterfaceId}
              onSelect={handleSelectInterface}
            />
          ) : null}

          </StageContent>

          <p className="workspace-footnote muted">
            <span className="footnote-en">{FOOTNOTE.en}</span>
            <span className="footnote-zh">{FOOTNOTE.zh}</span>
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
