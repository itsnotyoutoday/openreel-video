import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extendToolSchema,
  registerTool,
  resetToolExtensions,
  type EditingHost,
} from "@openreel/agent";
import { editingToolDefs, editingToolReadOnly } from "./editing-tools";
import {
  executeWithHostTools,
  hostToolReadOnly,
  withHostTools,
} from "./host-tools";

const host = {} as EditingHost;
const ok = (summary: string) => ({ ok: true, summary });

afterEach(() => resetToolExtensions());

describe("withHostTools", () => {
  it("returns the built-in editing tools untouched when no host registered anything", () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const defs = editingToolDefs(provider);
      expect(withHostTools(defs, provider)).toEqual(defs);
    }
  });

  it("appends host tools in the format of each provider", () => {
    registerTool({
      name: "host_lookup",
      description: "Look something up",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
      handler: () => ok("x"),
    });
    const openai = withHostTools(editingToolDefs("openai"), "openai").at(-1);
    expect(openai).toMatchObject({
      type: "function",
      function: { name: "host_lookup", description: "Look something up" },
    });
    const anthropic = withHostTools(editingToolDefs("anthropic"), "anthropic").at(-1);
    expect(anthropic).toMatchObject({ name: "host_lookup", input_schema: { type: "object" } });
  });

  it("applies schema extensions to a built-in editing tool", () => {
    extendToolSchema("add_marker", {
      properties: { note: { type: "string" } },
      description: "Include a note.",
    });
    const defs = withHostTools(editingToolDefs("openai"), "openai") as Array<{
      function: { name: string; description: string; parameters: { properties: Record<string, unknown> } };
    }>;
    const marker = defs.find((d) => d.function.name === "add_marker")!;
    expect(marker.function.parameters.properties.note).toEqual({ type: "string" });
    expect(marker.function.description).toMatch(/Include a note\.$/);
  });
});

describe("executeWithHostTools", () => {
  it("runs a host tool through the agent registry, not the built-in executor", async () => {
    registerTool({
      name: "host_lookup",
      description: "d",
      inputSchema: {},
      handler: (args) => ok(`q=${String(args.q)}`),
    });
    const builtin = vi.fn();
    expect(await executeWithHostTools("host_lookup", { q: "a" }, host, builtin)).toEqual(ok("q=a"));
    expect(builtin).not.toHaveBeenCalled();
  });

  it("passes built-in calls straight through when nothing extends them", async () => {
    const builtin = vi.fn().mockResolvedValue(ok("built-in"));
    const args = { time: 1 };
    await executeWithHostTools("add_marker", args, host, builtin);
    expect(builtin).toHaveBeenCalledWith("add_marker", args, host);
  });

  it("strips extension-only arguments before the built-in tool validates the call", async () => {
    extendToolSchema("add_marker", { properties: { note: { type: "string" } } });
    const builtin = vi.fn().mockResolvedValue(ok("built-in"));
    await executeWithHostTools("add_marker", { time: 1, note: "n" }, host, builtin);
    expect(builtin).toHaveBeenCalledWith("add_marker", { time: 1 }, host);
  });

  it("lets an extension answer a built-in call itself", async () => {
    extendToolSchema("add_marker", {
      properties: { note: { type: "string" } },
      intercept: (args) => (args.note === "deny" ? { ok: false, summary: "denied" } : undefined),
    });
    const builtin = vi.fn().mockResolvedValue(ok("built-in"));
    expect(await executeWithHostTools("add_marker", { note: "deny" }, host, builtin)).toEqual({
      ok: false,
      summary: "denied",
    });
    expect(builtin).not.toHaveBeenCalled();
  });
});

describe("hostToolReadOnly", () => {
  it("uses the host tool flag for host tools and the built-in rule otherwise", () => {
    registerTool({
      name: "host_read",
      description: "d",
      inputSchema: {},
      readOnly: true,
      handler: () => ok("x"),
    });
    expect(hostToolReadOnly("host_read", editingToolReadOnly)).toBe(true);
    expect(hostToolReadOnly("list_media", editingToolReadOnly)).toBe(true);
    expect(hostToolReadOnly("add_marker", editingToolReadOnly)).toBe(false);
  });
});
