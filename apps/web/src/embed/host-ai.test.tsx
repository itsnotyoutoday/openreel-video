// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { registerTool, resetToolExtensions } from "@openreel/agent";
import { createMemoryStorageProvider } from "@openreel/core";
import { setStorageProvider } from "../services/storage/storage-context";
import { useProjectStore } from "../stores/project-store";
import { useChatStore } from "../stores/chat-store";
import { useAIConnectionStore } from "../stores/ai-connection-store";
import { useSettingsStore } from "../stores/settings-store";
import { SettingsDialog } from "../components/editor/settings/SettingsDialog";
import { AISettingsPanel } from "../components/editor/settings/AISettingsPanel";
import { HostAiModelPicker } from "../components/editor/settings/HostAiModelPicker";
import { initHostAi, useHostAiStore } from "./host-ai";
import { ChatPanel } from "../components/editor/chat/ChatPanel";
import { HostRuntimeContext, setHostRuntime } from "./host-runtime";
import type { HostAiOptions, LLMTransport } from "./ai-types";
import type { EditorHostOptions } from "./types";
import type { ReactNode } from "react";

const completion = (message: Record<string, unknown>, finish: string) => ({
  choices: [{ message, finish_reason: finish }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
});

function scriptedTransport() {
  const bodies: Array<{ model?: string; messages?: Array<{ role: string; content?: unknown }> }> = [];
  let call = 0;
  const transport: LLMTransport = {
    async send(body, opts) {
      bodies.push(body as (typeof bodies)[number]);
      call += 1;
      if (call === 1) {
        return completion(
          {
            content: "",
            tool_calls: [{ id: "c1", type: "function", function: { name: "host_ping", arguments: "{}" } }],
          },
          "tool_calls",
        );
      }
      opts?.onDelta?.("All ");
      opts?.onDelta?.("done");
      return completion({ content: "All done" }, "stop");
    },
  };
  return { transport, bodies };
}

let teardown: (() => void) | undefined;

function install(options: EditorHostOptions) {
  setHostRuntime({
    options,
    root: document.body,
    getProject: () => useProjectStore.getState().getFullProject(),
  });
  teardown = initHostAi(options.ai);
}

beforeEach(() => {
  setStorageProvider(createMemoryStorageProvider());
  useProjectStore.getState().createNewProject("Host AI", { width: 1280, height: 720, frameRate: 30 });
  useChatStore.getState().reset();
});

afterEach(() => {
  cleanup();
  teardown?.();
  teardown = undefined;
  setHostRuntime(null);
  setStorageProvider(null);
  resetToolExtensions();
  useAIConnectionStore.setState({ apiKey: "" });
  vi.unstubAllGlobals();
});

describe("host AI (managed)", () => {
  it("runs a turn through the host transport with a host tool, and never calls fetch", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in managed mode")));
    vi.stubGlobal("fetch", fetchSpy);
    const pings = vi.fn();
    registerTool({
      name: "host_ping",
      description: "Pong",
      inputSchema: { type: "object", properties: {} },
      readOnly: true,
      handler: () => {
        pings();
        return { ok: true, summary: "pong" };
      },
    });
    const { transport, bodies } = scriptedTransport();
    const events = {
      onAiMessage: vi.fn(),
      onToolCall: vi.fn(),
    };
    const onUsage = vi.fn();
    const ai: HostAiOptions = {
      transport,
      managed: true,
      defaultModel: "host-model",
      systemPromptExtra: async () => "Prefer short cuts.",
      onUsage,
    };
    install({ ai, events });

    await act(async () => {
      await useChatStore.getState().send("ping please");
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pings).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].model).toBe("host-model");
    const system = bodies[0].messages?.find((m) => m.role === "system");
    expect(String(system?.content)).toContain("Prefer short cuts.");
    expect(useChatStore.getState().messages.at(-1)?.text).toBe("All done");
    expect(useChatStore.getState().error).toBeNull();

    expect(events.onToolCall).toHaveBeenCalledWith({ name: "host_ping", phase: "start" });
    expect(events.onToolCall).toHaveBeenCalledWith({ name: "host_ping", phase: "end", ok: true });
    expect(events.onAiMessage).toHaveBeenCalledWith({ role: "user", text: "ping please" });
    expect(events.onAiMessage).toHaveBeenCalledWith({ role: "assistant", text: "All done" });
    expect(onUsage).toHaveBeenCalledWith({ model: "host-model", inputTokens: 12, outputTokens: 7 });
  });

  it("does not need, read or store a browser key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const transport: LLMTransport = { send: async () => completion({ content: "Hi" }, "stop") };
    useAIConnectionStore.setState({ apiKey: "", model: "", baseUrl: "" });
    install({ ai: { transport, managed: true, defaultModel: "m" } });
    await act(async () => {
      await useChatStore.getState().send("hello");
    });
    expect(useChatStore.getState().error).toBeNull();
    expect(useAIConnectionStore.getState().apiKey).toBe("");
  });

  it("loads the model list and keeps the default model when it is offered", async () => {
    const { transport } = scriptedTransport();
    install({
      ai: {
        transport,
        managed: true,
        defaultModel: "fast",
        models: async () => [
          { id: "smart", label: "Smart" },
          { id: "fast", label: "Fast", note: "Cheapest" },
        ],
      },
    });
    await waitFor(() => expect(useHostAiStore.getState().models).toHaveLength(2));
    expect(useHostAiStore.getState().model).toBe("fast");
    render(<HostAiModelPicker />);
    expect((screen.getByLabelText("AI model") as HTMLSelectElement).value).toBe("fast");
    expect(screen.getByText("Cheapest")).toBeTruthy();
  });

  it("shows the host's settings content, or a managed note with the link, and no key fields", async () => {
    const { transport } = scriptedTransport();
    const renderSettings = vi.fn((el: HTMLElement) => {
      el.textContent = "Host settings";
      return () => undefined;
    });
    install({ ai: { transport, managed: true, defaultModel: "m", renderSettings } });
    render(<AISettingsPanel />);
    expect(screen.getByText("Host settings")).toBeTruthy();
    expect(screen.queryByLabelText("Session API key")).toBeNull();
    expect(screen.queryByLabelText("AI base URL")).toBeNull();
    expect(screen.queryByLabelText("AI provider")).toBeNull();
    cleanup();
    teardown?.();

    install({
      ai: { transport, managed: true, defaultModel: "m", settingsLink: { label: "Open Settings", href: "https://host.example/settings" } },
    });
    render(<AISettingsPanel />);
    expect(screen.getByTestId("ai-managed-note").textContent).toContain("Managed by the host");
    expect((screen.getByRole("link", { name: "Open Settings" }) as HTMLAnchorElement).href).toBe(
      "https://host.example/settings",
    );
  });

  it("drops the API Keys tab from the settings dialog", async () => {
    const { transport } = scriptedTransport();
    install({ ai: { transport, managed: true, defaultModel: "m" } });
    act(() => useSettingsStore.getState().openSettings("api-keys"));
    render(<SettingsDialog />);
    expect(await screen.findByRole("tab", { name: "General" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "AI Editor" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "API Keys" })).toBeNull();
    act(() => useSettingsStore.getState().closeSettings());
  });
});

describe("without the ai option", () => {
  it("behaves as before: asks for the person's own key and shows no host model picker", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    install({});
    useAIConnectionStore.setState({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "" });
    await act(async () => {
      await useChatStore.getState().send("hello");
    });
    expect(useChatStore.getState().error).toMatch(/session API key/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useHostAiStore.getState().options).toBeNull();
    render(<HostAiModelPicker />);
    expect(screen.queryByLabelText("AI model")).toBeNull();
    cleanup();
    render(<AISettingsPanel />);
    expect(screen.getByLabelText("Session API key")).toBeTruthy();
  });
});

describe("hostChrome aiSettings / aiProviders / preferences", () => {
  const hide = ["aiSettings", "aiProviders", "preferences"] as const;

  function renderWithChrome(ui: ReactNode, options: EditorHostOptions) {
    return render(
      <HostRuntimeContext.Provider
        value={{ options, root: document.body, getProject: () => useProjectStore.getState().getFullProject() }}
      >
        {ui}
      </HostRuntimeContext.Provider>,
    );
  }

  it("removes the provider, key, model-id and base-URL controls, the cogwheel and the General tab", async () => {
    const options: EditorHostOptions = { hostChrome: { hide: [...hide] } };
    install(options);
    renderWithChrome(
      <>
        <ChatPanel />
        <AISettingsPanel />
      </>,
      options,
    );
    for (const label of ["AI provider", "AI model ID", "AI base URL", "Session API key", "AI settings"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    cleanup();

    act(() => useSettingsStore.getState().openSettings("general"));
    renderWithChrome(<SettingsDialog />, options);
    expect(await screen.findByRole("tab", { name: "AI Editor" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "General" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "API Keys" })).toBeNull();
    expect(screen.queryByLabelText("AI provider")).toBeNull();
    act(() => useSettingsStore.getState().closeSettings());
  });

  it("keeps the cogwheel when the host renders its own settings, showing only that and the model picker", async () => {
    const { transport } = scriptedTransport();
    const options: EditorHostOptions = {
      hostChrome: { hide: [...hide] },
      ai: {
        transport,
        managed: true,
        defaultModel: "m",
        renderSettings: (el) => {
          el.textContent = "Summary from the host";
          return () => undefined;
        },
      },
    };
    install(options);
    renderWithChrome(
      <>
        <ChatPanel />
        <AISettingsPanel />
      </>,
      options,
    );
    expect(screen.getByLabelText("AI settings")).toBeTruthy();
    expect(screen.getByText("Summary from the host")).toBeTruthy();
    expect(screen.getByLabelText("AI model")).toBeTruthy();
    expect(screen.queryByText("Preview edits only")).toBeNull();
    expect(screen.queryByLabelText("AI provider")).toBeNull();
  });
});
