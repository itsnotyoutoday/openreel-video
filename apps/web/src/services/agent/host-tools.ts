import {
  applyExtensionsToSchema,
  executeTool,
  extensionPropertyNames,
  getSchemaExtensions,
  getTool,
  isHostTool,
  listHostTools,
  type EditingHost,
  type ToolResult,
} from "@openreel/agent";

type Provider = "openai" | "anthropic";
type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  host: EditingHost,
) => Promise<ToolResult>;

interface AnthropicDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
interface OpenAIDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function toProviderDef(
  provider: Provider,
  name: string,
  description: string,
  schema: Record<string, unknown>,
): unknown {
  return provider === "anthropic"
    ? ({ name, description, input_schema: schema } satisfies AnthropicDef)
    : ({
        type: "function",
        function: { name, description, parameters: schema },
      } satisfies OpenAIDef);
}

/**
 * The tool list the in-editor agent sends to the model: the editing tools it
 * ships with (with any schema extensions a host registered) followed by the
 * host's own tools. With nothing registered this returns `defs` unchanged.
 */
export function withHostTools(defs: unknown[], provider: Provider): unknown[] {
  const hostDefs = listHostTools().map((tool) =>
    toProviderDef(
      provider,
      tool.name,
      tool.description,
      applyExtensionsToSchema(tool.name, tool.inputSchema),
    ),
  );
  const extended = defs.map((def) => {
    const name =
      provider === "anthropic"
        ? (def as AnthropicDef).name
        : (def as OpenAIDef).function.name;
    const extensions = getSchemaExtensions(name);
    if (extensions.length === 0) return def;
    const base =
      provider === "anthropic"
        ? (def as AnthropicDef)
        : { ...(def as OpenAIDef).function, input_schema: (def as OpenAIDef).function.parameters };
    const description = [base.description, ...extensions.map((e) => e.description)]
      .filter(Boolean)
      .join(" ");
    return toProviderDef(
      provider,
      name,
      description,
      applyExtensionsToSchema(name, base.input_schema),
    );
  });
  return [...extended, ...hostDefs];
}

/**
 * Run a tool call for the in-editor agent. Host tools run through the agent
 * registry; for built-in tools, host schema extensions run first and their
 * own arguments are removed before the built-in tool validates the call.
 */
export async function executeWithHostTools(
  name: string,
  args: Record<string, unknown>,
  host: EditingHost,
  builtin: ToolExecutor,
): Promise<ToolResult> {
  if (isHostTool(name)) return executeTool(name, args, host);

  const extensions = getSchemaExtensions(name);
  if (extensions.length === 0) return builtin(name, args, host);

  for (const extension of extensions) {
    const early = await extension.intercept?.(args, host);
    if (early) return early;
  }
  const own = extensionPropertyNames(name);
  const remaining = Object.fromEntries(
    Object.entries(args).filter(([key]) => !own.has(key)),
  );
  return builtin(name, remaining, host);
}

/** Whether the agent may run a tool without changing the project. */
export function hostToolReadOnly(
  name: string,
  builtin: (name: string) => boolean,
): boolean {
  return isHostTool(name) ? getTool(name)?.readOnly === true : builtin(name);
}
