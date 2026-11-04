import { ToolcraftButton as Button, ToolcraftSwitchControl } from "@openreel/ui";
import { useChatStore } from "../../../stores/chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { AIConnectionPanel } from "./AIConnectionPanel";
import { HostAiModelPicker } from "./HostAiModelPicker";
import { HostMount } from "../../../embed/HostMount";
import { useHostAiStore } from "../../../embed/host-ai";
import { useChromeHidden } from "../../../embed/host-state";

export function AISettingsPanel() {
  const status = useChatStore((state) => state.status);
  const busy = status === "running" || status === "awaiting_confirm";
  const autoConfirm = useSettingsStore((state) => state.agentAutoConfirm);
  const setAutoConfirm = useSettingsStore((state) => state.setAgentAutoConfirm);
  const dryRun = useSettingsStore((state) => state.agentDryRun);
  const setDryRun = useSettingsStore((state) => state.setAgentDryRun);
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const hostAi = useHostAiStore((state) => state.options);
  const providersHidden = useChromeHidden("aiProviders");
  // AI cogwheel hidden but kept for the host's own content: summary and model picker only.
  const summaryOnly = useChromeHidden("aiSettings");

  return (
    <div className="space-y-5 pb-1">
      <div>
        <h3 className="text-sm font-medium text-fg">{hostAi ? "AI model" : "Model connection"}</h3>
        <p className="mt-1 text-xs text-fg-muted">Choose the model that helps edit your timeline.</p>
      </div>
      {busy && <p role="status" className="text-xs text-fg-muted">You can change these settings when the current edit finishes.</p>}
      {hostAi ? (
        <div className="space-y-4">
          <HostAiModelPicker disabled={busy} />
          {hostAi.renderSettings ? (
            <HostMount
              label="AI settings from the host"
              className="text-sm text-fg"
              mount={(el) => hostAi.renderSettings!(el)}
            />
          ) : (
            <p className="rounded-md border border-border bg-bg-2 p-3 text-xs text-fg-2" data-testid="ai-managed-note">
              Managed by the host.
              {hostAi.settingsLink && (
                <>
                  {" "}
                  <a
                    href={hostAi.settingsLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    {hostAi.settingsLink.label}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      ) : providersHidden ? null : (
        <AIConnectionPanel disabled={busy} />
      )}
      {!summaryOnly && (
      <div className="space-y-3 border-t border-border pt-4">
        <ToolcraftSwitchControl
          label="Preview edits only"
          description="Plan changes without applying them to the timeline."
          checked={dryRun}
          onCheckedChange={setDryRun}
          disabled={busy}
        />
        <ToolcraftSwitchControl
          label="Auto-approve edits"
          description="Run actions such as deleting clips without asking for confirmation."
          checked={autoConfirm}
          onCheckedChange={setAutoConfirm}
          disabled={busy}
        />
      </div>
      )}
      <div className="flex justify-end border-t border-border pt-4">
        <Button label="Done" variant="primary" size="sm" onClick={closeSettings} />
      </div>
    </div>
  );
}
