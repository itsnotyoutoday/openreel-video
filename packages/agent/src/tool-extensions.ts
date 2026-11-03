import type { EditingHost } from "./host";
import type { JSONSchema, ToolDef, ToolResult } from "./types";

/**
 * A tool as the registry stores it. Defined here (not imported from
 * `registry.ts`) so this module has no runtime dependency on the registry.
 */
export interface ExtensibleTool extends ToolDef {
  readonly handler: (
    args: Record<string, unknown>,
    host: EditingHost,
  ) => Promise<ToolResult> | ToolResult;
}

/** A tool a host adds. `domain` defaults to `"host"`; flags default to false. */
export interface HostToolDefinition {
  /** Unique, `[a-zA-Z0-9_-]{1,64}`; must not collide with a built-in tool. */
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** JSON Schema for the arguments (an object schema). */
  readonly inputSchema: JSONSchema;
  readonly domain?: ToolDef["domain"];
  readonly readOnly?: boolean;
  /** Needs the user's confirmation before it runs. */
  readonly destructive?: boolean;
  /** Needs the user's confirmation because it is slow or costly. */
  readonly expensive?: boolean;
  /**
   * Keep the tool in every turn's tool list. Without it the tool router may
   * drop the tool when a prompt is about Motion or 3D work.
   */
  readonly alwaysAvailable?: boolean;
  readonly handler: ExtensibleTool["handler"];
}

/** Extra arguments for an existing (built-in or host) tool. */
export interface ToolSchemaExtension {
  /** Properties merged into the tool's `inputSchema.properties`. */
  readonly properties: Record<string, JSONSchema>;
  /** Names added to `inputSchema.required`. */
  readonly required?: readonly string[];
  /** Text appended to the tool description (separated by a space). */
  readonly description?: string;
  /**
   * Runs before the tool with the full arguments. Return a result to answer
   * the call yourself (the tool does not run); return nothing to continue.
   * The extension's own properties are consumed here and stripped before the
   * built-in tool is called by the in-editor agent.
   */
  readonly intercept?: (
    args: Record<string, unknown>,
    host: EditingHost,
  ) => Promise<ToolResult | void> | ToolResult | void;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const hostTools = new Map<string, ExtensibleTool>();
const alwaysAvailable = new Set<string>();
const extensions = new Map<string, ToolSchemaExtension[]>();
let isBuiltin: (name: string) => boolean = () => false;

/** Wired by the registry so a host tool cannot shadow a built-in one. */
export function configureBuiltinLookup(lookup: (name: string) => boolean): void {
  isBuiltin = lookup;
}

/**
 * Add a tool the agent can call. Returns a function that removes it again.
 * Throws if the name is invalid, taken by a built-in, or already registered.
 */
export function registerTool(definition: HostToolDefinition): () => void {
  const { name } = definition;
  if (!TOOL_NAME.test(name)) {
    throw new Error(`Invalid tool name "${name}"; use letters, digits, "_" or "-" (max 64)`);
  }
  if (isBuiltin(name)) {
    throw new Error(`"${name}" is a built-in tool and cannot be replaced`);
  }
  if (hostTools.has(name)) {
    throw new Error(`A tool named "${name}" is already registered`);
  }
  const tool: ExtensibleTool = {
    name,
    domain: definition.domain ?? "host",
    title: definition.title ?? name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    readOnly: definition.readOnly ?? false,
    destructive: definition.destructive ?? false,
    expensive: definition.expensive ?? false,
    handler: definition.handler,
  };
  hostTools.set(name, tool);
  if (definition.alwaysAvailable) alwaysAvailable.add(name);
  return () => unregisterTool(name, tool);
}

/** Remove a registered host tool. Returns whether one was removed. */
export function unregisterTool(name: string, only?: ExtensibleTool): boolean {
  const existing = hostTools.get(name);
  if (!existing || (only && existing !== only)) return false;
  hostTools.delete(name);
  alwaysAvailable.delete(name);
  return true;
}

/**
 * Extend the arguments of an existing tool. Returns a function that removes
 * the extension. Extensions for the same tool apply in registration order.
 */
export function extendToolSchema(
  toolName: string,
  extension: ToolSchemaExtension,
): () => void {
  const list = extensions.get(toolName) ?? [];
  list.push(extension);
  extensions.set(toolName, list);
  return () => {
    const current = extensions.get(toolName);
    if (!current) return;
    const next = current.filter((entry) => entry !== extension);
    if (next.length) extensions.set(toolName, next);
    else extensions.delete(toolName);
  };
}

export function getHostTool(name: string): ExtensibleTool | undefined {
  return hostTools.get(name);
}

export function listHostTools(): ExtensibleTool[] {
  return [...hostTools.values()];
}

export function isHostTool(name: string): boolean {
  return hostTools.has(name);
}

export function isAlwaysAvailableHostTool(name: string): boolean {
  return alwaysAvailable.has(name);
}

export function getSchemaExtensions(toolName: string): readonly ToolSchemaExtension[] {
  return extensions.get(toolName) ?? [];
}

/** Names of the properties extensions added to a tool. */
export function extensionPropertyNames(toolName: string): Set<string> {
  return new Set(getSchemaExtensions(toolName).flatMap((e) => Object.keys(e.properties)));
}

/** Merge extensions into one input schema. */
export function applyExtensionsToSchema(
  toolName: string,
  schema: JSONSchema,
): JSONSchema {
  const list = getSchemaExtensions(toolName);
  if (list.length === 0) return schema;
  const properties: Record<string, JSONSchema> = {
    ...((schema.properties as Record<string, JSONSchema> | undefined) ?? {}),
  };
  const required = new Set<string>((schema.required as string[] | undefined) ?? []);
  for (const entry of list) {
    Object.assign(properties, entry.properties);
    entry.required?.forEach((name) => required.add(name));
  }
  return { ...schema, type: schema.type ?? "object", properties, required: [...required] };
}

/** Merge extensions into a tool as the registry returns it. */
export function extendTool<T extends ExtensibleTool>(tool: T): T {
  const list = getSchemaExtensions(tool.name);
  if (list.length === 0) return tool;
  const description = [tool.description, ...list.map((e) => e.description)]
    .filter(Boolean)
    .join(" ");
  const handler: ExtensibleTool["handler"] = async (args, host) => {
    for (const entry of list) {
      const early = await entry.intercept?.(args, host);
      if (early) return early;
    }
    return tool.handler(args, host);
  };
  return {
    ...tool,
    description,
    inputSchema: applyExtensionsToSchema(tool.name, tool.inputSchema),
    handler,
  };
}

/** Remove everything a host registered (used by tests and on unmount). */
export function resetToolExtensions(): void {
  hostTools.clear();
  alwaysAvailable.clear();
  extensions.clear();
}
