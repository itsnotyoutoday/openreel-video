import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyMarkerClick, setHostMarkers, useHostMarkers } from "./host-markers";
import { setHostRuntime, type HostRuntime } from "./host-runtime";

afterEach(() => {
  setHostRuntime(null);
  useHostMarkers.setState({ markers: [] });
});

describe("host markers", () => {
  it("stores markers sorted by time, clamped at 0, with only the known fields", () => {
    setHostMarkers([
      { id: "b", time: 4, label: "Note", color: "#f00" },
      { id: "a", time: -1, extra: true } as never,
    ]);
    expect(useHostMarkers.getState().markers).toEqual([
      { id: "a", time: 0 },
      { id: "b", time: 4, label: "Note", color: "#f00" },
    ]);
    setHostMarkers([]);
    expect(useHostMarkers.getState().markers).toEqual([]);
  });

  it("rejects markers without an id or a finite time", () => {
    expect(() => setHostMarkers([{ id: "x", time: Number.NaN }])).toThrow();
    expect(() => setHostMarkers([{ time: 1 } as never])).toThrow();
    expect(() => setHostMarkers("nope" as never)).toThrow();
  });

  it("tells the host about a click, and survives a failing callback", () => {
    const onMarkerClick = vi.fn();
    setHostRuntime({ options: { events: { onMarkerClick } } } as unknown as HostRuntime);
    notifyMarkerClick({ id: "m", time: 2, label: "Fix this" });
    expect(onMarkerClick).toHaveBeenCalledWith({ id: "m", time: 2, label: "Fix this" });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setHostRuntime({
      options: {
        events: {
          onMarkerClick: () => {
            throw new Error("boom");
          },
        },
      },
    } as unknown as HostRuntime);
    expect(() => notifyMarkerClick({ id: "m", time: 2 })).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
