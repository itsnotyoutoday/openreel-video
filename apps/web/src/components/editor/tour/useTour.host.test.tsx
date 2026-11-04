import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTour } from "./useTour";
import { ONBOARDING_KEY } from "./tour-steps";
import { HostRuntimeContext, type HostRuntime } from "../../../embed/host-runtime";
import type { EditorHostOptions } from "../../../embed/types";

const wrapper = (options: EditorHostOptions) => ({ children }: { children: ReactNode }) => {
  const runtime: HostRuntime = { options, root: document.createElement("div"), getProject: () => ({}) as never };
  return <HostRuntimeContext.Provider value={runtime}>{children}</HostRuntimeContext.Provider>;
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.removeItem(ONBOARDING_KEY);
});
afterEach(() => { vi.useRealTimers(); });

describe("first-run tour", () => {
  it("starts by default, as in the standalone app", () => {
    const { result } = renderHook(() => useTour());
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.isActive).toBe(true);
    act(() => result.current.skip());
  });

  it("starts for an embedded editor unless the host opts out", () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrapper({}) });
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.isActive).toBe(true);
    act(() => result.current.skip());
  });

  it("does not start when the host passes onboardingTour: false", () => {
    const { result } = renderHook(() => useTour(), { wrapper: wrapper({ onboardingTour: false }) });
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.isActive).toBe(false);
  });
});
