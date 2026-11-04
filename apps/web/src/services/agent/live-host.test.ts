import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Action } from "@openreel/core";
import { executeTool } from "@openreel/agent";
import type { EditorStateView } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { LiveEditorHost } from "./live-host";

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}`,
  timestamp: Date.now(),
  params,
});

describe("LiveEditorHost", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject();
  });

  it("drives the live store through the agent executor", async () => {
    const host = new LiveEditorHost();
    const before = useProjectStore.getState().project.timeline.tracks.length;

    const res = await executeTool("add_track", { trackType: "video" }, host);
    expect(res.ok).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 1);

    const state = (await executeTool("get_editor_state", {}, host)).data as EditorStateView;
    expect(state.trackCount).toBe(before + 1);
  });

  it("requireOpenProject throws when no project is open", () => {
    useProjectStore.setState({ hasOpenProject: false });
    const host = new LiveEditorHost();
    expect(() => host.getProject()).toThrow(/No project is open/);
  });

  it("rolls a transaction back as one unit", async () => {
    const host = new LiveEditorHost();
    const before = useProjectStore.getState().project.timeline.tracks.length;

    const txn = host.beginTransaction("turn");
    await host.applyAction(act("track/add", { trackType: "text" }));
    await host.applyAction(act("track/add", { trackType: "graphics" }));
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 2);

    await host.rollbackTransaction(txn);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before);
  });

  it("exposes the capability manifest", () => {
    const host = new LiveEditorHost();
    expect(host.capabilities().blendModes.length).toBeGreaterThan(0);
  });

  describe("importMediaFromUrl on the web", () => {
    const stubImport = () => {
      const importMedia = vi.fn(async (file: File) => {
        const state = useProjectStore.getState();
        useProjectStore.setState({
          project: {
            ...state.project,
            mediaLibrary: {
              items: [
                ...state.project.mediaLibrary.items,
                {
                  id: "media-url-1",
                  name: file.name,
                  type: "video",
                  fileHandle: null,
                  blob: file,
                  thumbnailUrl: null,
                  waveformData: null,
                  metadata: { duration: 3, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 2, fileSize: file.size },
                },
              ],
            },
          },
        });
        return { success: true, actionId: "media-url-1" };
      });
      useProjectStore.setState({ importMedia } as never);
      return importMedia;
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fetches the URL, imports it as a File and records the source URL", async () => {
      const importMedia = stubImport();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Blob(["frames"]), { status: 200, headers: { "content-type": "video/mp4" } })),
      );
      const host = new LiveEditorHost();

      const ref = await host.importMediaFromUrl("https://cdn.example.com/clips/shot.mp4");

      expect(ref).toMatchObject({ mediaId: "media-url-1", name: "shot.mp4", type: "video", durationSec: 3 });
      const file = importMedia.mock.calls[0][0] as File;
      expect(file.name).toBe("shot.mp4");
      expect(file.type).toBe("video/mp4");
      const item = useProjectStore.getState().project.mediaLibrary.items.find((m) => m.id === "media-url-1");
      expect(item?.originalUrl).toBe("https://cdn.example.com/clips/shot.mp4");
    });

    it("rejects non-http(s) URLs without fetching", async () => {
      stubImport();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const host = new LiveEditorHost();

      await expect(host.importMediaFromUrl("file:///etc/passwd")).rejects.toThrow(/http/);
      await expect(host.importMediaFromUrl("not a url")).rejects.toThrow(/Invalid media URL/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reports HTTP errors and cross-origin failures", async () => {
      const importMedia = stubImport();
      const host = new LiveEditorHost();

      vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
      await expect(host.importMediaFromUrl("https://cdn.example.com/missing.mp4")).rejects.toThrow(/HTTP 404/);

      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
      await expect(host.importMediaFromUrl("https://cdn.example.com/blocked.mp4")).rejects.toThrow(/cross-origin/);
      expect(importMedia).not.toHaveBeenCalled();
    });

    it("rejects files whose declared size exceeds the import limit", async () => {
      stubImport();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("x", { status: 200, headers: { "content-length": String(2 * 1024 * 1024 * 1024) } })),
      );
      await expect(new LiveEditorHost().importMediaFromUrl("https://cdn.example.com/huge.mp4")).rejects.toThrow(/too large/);
    });
  });
});
