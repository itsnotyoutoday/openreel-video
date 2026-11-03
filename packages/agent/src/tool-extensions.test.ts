import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditingHost } from "./host";
import {
  executeTool,
  extendToolSchema,
  getTool,
  isDestructive,
  isExpensive,
  isHostTool,
  listTools,
  registerTool,
  resetToolExtensions,
  selectToolsForPrompt,
  toAnthropicTools,
  toOpenAITools,
  toolDefs,
  unregisterTool,
} from "./index";

const host = {} as EditingHost;
const ok = (summary: string) => ({ ok: true, summary });
const baseline = listTools().length;
const builtinName = listTools()[0].name;

afterEach(() => resetToolExtensions());

describe("registerTool", () => {
  it("adds a tool every listing and the executor can see, and removes it again", async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) => ok(`hi ${String(args.who)}`));
    const remove = registerTool({
      name: "host_greet",
      description: "Greet someone",
      inputSchema: { type: "object", properties: { who: { type: "string" } }, required: ["who"] },
      handler,
    });

    expect(isHostTool("host_greet")).toBe(true);
    expect(getTool("host_greet")?.domain).toBe("host");
    expect(listTools()).toHaveLength(baseline + 1);
    expect(toolDefs().some((t) => t.name === "host_greet")).toBe(true);
    expect(toOpenAITools().some((t) => t.function.name === "host_greet")).toBe(true);
    expect(toAnthropicTools(["host_greet"])[0].input_schema).toMatchObject({ required: ["who"] });
    expect(await executeTool("host_greet", { who: "Ada" }, host)).toEqual(ok("hi Ada"));
    expect(handler).toHaveBeenCalledOnce();

    remove();
    expect(isHostTool("host_greet")).toBe(false);
    expect(getTool("host_greet")).toBeUndefined();
    expect(listTools()).toHaveLength(baseline);
    expect((await executeTool("host_greet", {}, host)).error?.code).toBe("UNKNOWN_TOOL");
  });

  it("carries the confirmation flags into the executor helpers", () => {
    registerTool({
      name: "host_wipe",
      description: "Danger",
      inputSchema: { type: "object" },
      destructive: true,
      expensive: true,
      handler: () => ok("done"),
    });
    expect(isDestructive("host_wipe")).toBe(true);
    expect(isExpensive("host_wipe")).toBe(true);
    expect(isDestructive("host_other")).toBe(false);
  });

  it("rejects built-in names, duplicates and invalid names", () => {
    const tool = { description: "x", inputSchema: {}, handler: () => ok("x") };
    expect(() => registerTool({ ...tool, name: builtinName })).toThrow(/built-in/);
    registerTool({ ...tool, name: "host_a" });
    expect(() => registerTool({ ...tool, name: "host_a" })).toThrow(/already registered/);
    expect(() => registerTool({ ...tool, name: "has space" })).toThrow(/Invalid tool name/);
  });

  it("unregisterTool by name is false for an unknown tool", () => {
    expect(unregisterTool("nothing")).toBe(false);
  });

  it("a stale remove function does not remove a newer registration of the same name", () => {
    const tool = { description: "x", inputSchema: {}, handler: () => ok("x") };
    const first = registerTool({ ...tool, name: "host_a" });
    unregisterTool("host_a");
    registerTool({ ...tool, name: "host_a" });
    first();
    expect(isHostTool("host_a")).toBe(true);
  });

  it("leaves the built-in registry unchanged when nothing is registered", () => {
    expect(listTools()).toHaveLength(baseline);
    expect(toolDefs().some((t) => t.domain === "host")).toBe(false);
  });
});

describe("extendToolSchema", () => {
  it("merges properties, required names and description into a built-in tool", () => {
    const before = getTool(builtinName)!;
    const remove = extendToolSchema(builtinName, {
      properties: { reason: { type: "string" } },
      required: ["reason"],
      description: "Always give a reason.",
    });
    const after = getTool(builtinName)!;
    expect((after.inputSchema.properties as Record<string, unknown>).reason).toEqual({ type: "string" });
    expect(after.inputSchema.required).toContain("reason");
    expect(after.description).toBe(`${before.description} Always give a reason.`);
    expect(toOpenAITools([builtinName])[0].function.parameters).toMatchObject({
      properties: { reason: { type: "string" } },
    });

    remove();
    expect(getTool(builtinName)!.inputSchema).toEqual(before.inputSchema);
    expect(getTool(builtinName)!.description).toBe(before.description);
  });

  it("lets an extension answer a call before the tool runs", async () => {
    registerTool({
      name: "host_echo",
      description: "Echo",
      inputSchema: { type: "object" },
      handler: () => ok("real"),
    });
    const remove = extendToolSchema("host_echo", {
      properties: { dryRun: { type: "boolean" } },
      intercept: (args) => (args.dryRun ? ok("dry") : undefined),
    });
    expect(await executeTool("host_echo", { dryRun: true }, host)).toEqual(ok("dry"));
    expect(await executeTool("host_echo", {}, host)).toEqual(ok("real"));
    remove();
    expect(await executeTool("host_echo", { dryRun: true }, host)).toEqual(ok("real"));
  });
});

describe("tool routing", () => {
  const motionPrompt = "animate this lower third with a particle shader";

  it("keeps an always-available host tool for prompts that filter other domains", () => {
    registerTool({
      name: "host_pinned",
      description: "Pinned",
      inputSchema: {},
      alwaysAvailable: true,
      handler: () => ok("p"),
    });
    registerTool({
      name: "host_plain",
      description: "Plain",
      inputSchema: {},
      handler: () => ok("p"),
    });
    const motion = selectToolsForPrompt(motionPrompt);
    expect(motion).toContain("host_pinned");
    expect(motion).not.toContain("host_plain");
    expect(selectToolsForPrompt("use the plain host tool")).toContain("host_plain");
  });
});
