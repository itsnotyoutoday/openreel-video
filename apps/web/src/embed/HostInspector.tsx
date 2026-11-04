import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Puzzle } from "@/icons/lucide-compat";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { hostClipInfo, JOIN_PREFIX, mergeHostMetadata, sameHostClip } from "./host-clips";
import { HostIcon, HostMount } from "./HostMount";
import { useHostRuntime } from "./host-runtime";
import { useHostState } from "./host-state";
import type { Project } from "@openreel/core";
import type { HostClipInfo, HostInspectorApi, HostInspectorTab, HostSelection } from "./types";

const NATIVE = "__native";

/** The selection as the host's tabs see it: nothing, a clip, clips, or the join between two clips. */
function hostSelectionOf(project: Project, items: ReadonlyArray<{ id: string; type: string; trackId?: string }>): HostSelection {
  const transition = items.find((item) => item.type === "transition");
  if (transition?.id.startsWith(JOIN_PREFIX)) {
    const [clipA, clipB] = transition.id.slice(JOIN_PREFIX.length).split(":");
    return clipA && clipB ? { join: { between: [clipA, clipB] } } : null;
  }
  if (transition) {
    const track = project.timeline.tracks.find((t) => t.id === transition.trackId);
    const found = track?.transitions.find((t) => t.id === transition.id);
    if (found?.clipBId) return { join: { between: [found.clipAId, found.clipBId] } };
    return null;
  }
  const clips = items
    .filter((item) => item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip")
    .map((item) => hostClipInfo(project, item.id))
    .filter((info): info is HostClipInfo => info !== undefined);
  if (clips.length === 0) return null;
  return clips.length === 1 ? clips[0] : clips;
}

function isClips(selection: HostSelection): selection is HostClipInfo | readonly HostClipInfo[] {
  return selection !== null && !("join" in selection);
}

function appliesToSelection(tab: HostInspectorTab, selection: HostSelection, replace: boolean): boolean {
  if (tab.when) {
    try {
      return tab.when(selection);
    } catch (error) {
      console.error(`[OpenReel] Inspector tab "${tab.id}" when() failed:`, error);
      return false;
    }
  }
  // no condition: tabs next to the editor's own inspector show for clips; a host-owned column always shows them
  return replace || isClips(selection);
}

interface TabState {
  current: HostClipInfo | null;
  readonly listeners: Set<(clip: HostClipInfo | null) => void>;
}

function Tabs({
  tabs,
  replace,
  children,
}: {
  tabs: readonly HostInspectorTab[];
  replace: boolean;
  children: ReactNode;
}): ReactElement {
  const project = useProjectStore((state) => state.project);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const selection = useMemo<HostSelection>(
    () => hostSelectionOf(project, selectedItems),
    [project, selectedItems],
  );
  const selectedId = selectedItems.find(
    (item) => item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip",
  )?.id;
  const info = useMemo(
    () => (selectedId ? hostClipInfo(project, selectedId) : undefined),
    [project, selectedId],
  );
  const applicable = useMemo(
    () => tabs.filter((tab) => appliesToSelection(tab, selection, replace)),
    [tabs, selection, replace],
  );

  const [chosen, setChosen] = useState<string>(NATIVE);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const fallback = replace ? (applicable[0]?.id ?? NATIVE) : NATIVE;
  const active = applicable.some((tab) => tab.id === chosen) ? chosen : fallback;
  const states = useRef(new Map<string, TabState>());
  const selectionListeners = useRef(new Set<(selection: HostSelection) => void>());
  const latest = useRef<HostClipInfo | undefined>(undefined);
  const latestSelection = useRef<HostSelection>(null);
  const previous = useRef<HostClipInfo | undefined>(undefined);
  latest.current = info;
  latestSelection.current = selection;

  const stateFor = (id: string): TabState => {
    let state = states.current.get(id);
    if (!state) {
      state = { current: info ?? null, listeners: new Set() };
      states.current.set(id, state);
    }
    return state;
  };

  // Tell mounted tabs about selection changes and edits to the clip they show.
  useEffect(() => {
    if (sameHostClip(previous.current, info)) return;
    previous.current = info;
    for (const tab of tabs) {
      const state = states.current.get(tab.id);
      if (!state) continue;
      const next = info && appliesToSelection(tab, info, replace) ? info : null;
      state.current = next;
      for (const listener of [...state.listeners]) {
        try {
          listener(next);
        } catch (error) {
          console.error(`[OpenReel] Inspector tab "${tab.id}" listener failed:`, error);
        }
      }
    }
  }, [info, tabs, replace]);

  // listeners hear about changes, not about the selection they were mounted with
  const firstSelection = useRef(true);
  useEffect(() => {
    if (firstSelection.current) {
      firstSelection.current = false;
      return;
    }
    for (const listener of [...selectionListeners.current]) {
      try {
        listener(selection);
      } catch (error) {
        console.error("[OpenReel] An inspector selection listener failed:", error);
      }
    }
  }, [selection]);

  const choose = (id: string) => {
    setChosen(id);
    if (id !== NATIVE) setVisited((set) => (set.has(id) ? set : new Set(set).add(id)));
  };

  // editor.openInspectorTab(id): open the tab as soon as it applies (for at most five seconds)
  const request = useHostState((state) => state.inspectorRequest);
  const handledRequest = useRef(0);
  useEffect(() => {
    if (!request || request.n === handledRequest.current) return;
    if (Date.now() - request.at > 5000) {
      handledRequest.current = request.n;
      return;
    }
    if (applicable.some((tab) => tab.id === request.id)) {
      handledRequest.current = request.n;
      setChosen(request.id);
      setVisited((set) => (set.has(request.id) ? set : new Set(set).add(request.id)));
    }
  }, [request, applicable]);

  // activateOnSelect: a newly selected clip opens the tab that asks for it
  const lastSelectedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedId === lastSelectedId.current) return;
    lastSelectedId.current = selectedId;
    const auto = applicable.find((tab) => tab.activateOnSelect);
    if (selectedId && auto) {
      setChosen(auto.id);
      setVisited((set) => (set.has(auto.id) ? set : new Set(set).add(auto.id)));
    }
  }, [selectedId, applicable]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = replace ? applicable.map((tab) => tab.id) : [NATIVE, ...applicable.map((tab) => tab.id)];
    const index = ids.indexOf(active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % ids.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    else return;
    event.preventDefault();
    choose(ids[next]);
    requestAnimationFrame(() =>
      event.currentTarget.querySelector<HTMLElement>(`[data-host-tab="${ids[next]}"]`)?.focus(),
    );
  };

  const api = (tab: HostInspectorTab): HostInspectorApi => {
    const state = stateFor(tab.id);
    return {
      get clip() {
        return (state.current ?? latest.current) as HostClipInfo;
      },
      current: () => state.current ?? latest.current ?? null,
      get selection() {
        return latestSelection.current;
      },
      onClipChange(cb) {
        state.listeners.add(cb);
        return () => state.listeners.delete(cb);
      },
      onSelectionChange(cb) {
        selectionListeners.current.add(cb);
        return () => selectionListeners.current.delete(cb);
      },
      updateMetadata(patch) {
        const id = (state.current ?? latest.current)?.id;
        if (!id) return;
        mergeHostMetadata(id, patch).catch((error: unknown) => {
          console.error("[OpenReel] updateMetadata failed:", error);
        });
      },
    };
  };

  const tabClass = (isActive: boolean) =>
    `flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
      isActive ? "bg-selected font-semibold text-accent" : "text-fg-3 hover:text-fg"
    }`;

  // In replace mode the open tab mounts at once; otherwise a tab mounts when first opened.
  const mounted = (id: string) => visited.has(id) || (replace && active === id);
  const showBar = replace ? applicable.length > 1 : applicable.length > 0;

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-bg-1"
      data-host-inspector={replace ? "replace" : "tabs"}
    >
      {showBar && (
        <div
          role="tablist"
          aria-label="Inspector sections"
          onKeyDown={onKeyDown}
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-bg-1 px-2 py-1 scrollbar-none"
        >
          {!replace && (
            <button
              type="button"
              role="tab"
              id="host-inspector-tab-native"
              data-host-tab={NATIVE}
              aria-selected={active === NATIVE}
              tabIndex={active === NATIVE ? 0 : -1}
              onClick={() => choose(NATIVE)}
              className={tabClass(active === NATIVE)}
            >
              Properties
            </button>
          )}
          {applicable.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`host-inspector-tab-${tab.id}`}
              data-host-tab={tab.id}
              aria-selected={active === tab.id}
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => choose(tab.id)}
              className={tabClass(active === tab.id)}
            >
              <HostIcon icon={tab.icon} size={13} fallback={<Puzzle size={13} aria-hidden />} />
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {!replace && <div className={active === NATIVE ? "min-h-0 flex-1" : "hidden"}>{children}</div>}
      {tabs.map((tab) =>
        mounted(tab.id) ? (
          <HostMount
            key={tab.id}
            label={tab.label}
            className={`min-h-0 flex-1 overflow-auto bg-bg-1 p-3 text-fg ${active === tab.id ? "" : "hidden"}`}
            mount={(el) => tab.mount(el, api(tab))}
          />
        ) : null,
      )}
    </div>
  );
}

/**
 * Wraps the inspector. With host inspector tabs it adds a tab bar (the editor's
 * own properties first); with `hostPanels.inspector.mode === "replace"` it shows
 * only the host's tabs and never renders the editor's own inspector. Without
 * either, it renders `children` unchanged.
 */
export function HostInspectorTabs({ children }: { children: ReactNode }): ReactElement {
  const panels = useHostRuntime()?.options.hostPanels;
  const replace = panels?.inspector?.mode === "replace";
  const tabs = replace ? (panels?.inspector?.tabs ?? panels?.inspectorTabs) : (panels?.inspectorTabs);
  if (!tabs || tabs.length === 0) return replace ? <></> : <>{children}</>;
  return (
    <Tabs tabs={tabs} replace={replace}>
      {children}
    </Tabs>
  );
}
