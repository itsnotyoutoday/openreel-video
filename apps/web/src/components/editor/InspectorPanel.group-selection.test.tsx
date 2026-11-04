import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Clip, ClipGroup, Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { InspectorPanel } from "./InspectorPanel";
import { selectedLockedGroup } from "./inspector/group-selection";

const TRACK_ID = "scene-track";

function clip(id: string, startTime: number, groupId?: string): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: TRACK_ID,
    startTime,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
    ...(groupId ? { groupId } : {}),
  } as Clip;
}

function projectWith(clips: Clip[], groups: ClipGroup[]): Project {
  const empty = createEmptyProject("Groups");
  return {
    ...empty,
    clipGroups: groups,
    timeline: {
      ...empty.timeline,
      duration: 8,
      tracks: [
        {
          id: TRACK_ID,
          type: "video",
          name: "Video",
          clips,
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}

const select = (ids: string[]) =>
  useUIStore.getState().selectMultiple(ids.map((id) => ({ type: "clip" as const, id, trackId: TRACK_ID })));

describe("selecting a locked group", () => {
  const locked: ClipGroup = { id: "g1", locked: true, label: "Scene 1" };
  const clips = [clip("a", 0, "g1"), clip("b", 2, "g1"), clip("c", 4, "g1"), clip("loose", 6)];

  beforeEach(() => {
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({ hasOpenProject: true, project: projectWith(clips, [locked]) });
  });

  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });

  it("shows a group summary instead of the Batch Transform panel", () => {
    select(["a", "b", "c"]);
    render(<InspectorPanel />);

    expect(screen.queryByText("Batch Transform")).toBeNull();
    expect(screen.getByText("Scene 1")).toBeInTheDocument();
    expect(screen.getByText(/3 clips, locked together/)).toBeInTheDocument();
  });

  it("still shows the Batch Transform panel for an ordinary multi-selection", () => {
    select(["a", "loose"]);
    render(<InspectorPanel />);
    expect(screen.getByText("Batch Transform")).toBeInTheDocument();
  });

  it("still shows the Batch Transform panel for part of a group", () => {
    select(["a", "b"]);
    render(<InspectorPanel />);
    expect(screen.getByText("Batch Transform")).toBeInTheDocument();
  });

  it("does not treat an unlocked group as one item", () => {
    useProjectStore.setState({ project: projectWith(clips, [{ ...locked, locked: false }]) });
    select(["a", "b", "c"]);
    render(<InspectorPanel />);
    expect(screen.getByText("Batch Transform")).toBeInTheDocument();
  });
});

describe("selectedLockedGroup", () => {
  const group: ClipGroup = { id: "g1", locked: true };
  const project = projectWith([clip("a", 0, "g1"), clip("b", 2, "g1"), clip("x", 4, "g2")], [group, { id: "g2", locked: true }]);

  it("needs every member and nothing else", () => {
    expect(selectedLockedGroup(project, ["a", "b"])).toEqual(group);
    expect(selectedLockedGroup(project, ["b", "a"])).toEqual(group);
    expect(selectedLockedGroup(project, ["a"])).toBeNull();
    expect(selectedLockedGroup(project, ["a", "x"])).toBeNull();
    expect(selectedLockedGroup(project, ["a", "b", "missing"])).toBeNull();
    expect(selectedLockedGroup(project, [])).toBeNull();
  });

  it("is null for a group id that is not in the project", () => {
    const orphan = projectWith([clip("a", 0, "gone"), clip("b", 2, "gone")], []);
    expect(selectedLockedGroup(orphan, ["a", "b"])).toBeNull();
  });
});
