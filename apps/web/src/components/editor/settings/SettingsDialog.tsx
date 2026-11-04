import React, { useCallback, useEffect, useRef } from "react";
import { Settings, Key, Plug, Bot } from "@/icons/lucide-compat";
import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent } from "@openreel/ui";
import { useSettingsStore, type SettingsTab } from "../../../stores/settings-store";
import { GeneralPanel } from "./GeneralPanel";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { McpPanel } from "./McpPanel";
import { AISettingsPanel } from "./AISettingsPanel";
import { useHostAiStore } from "../../../embed/host-ai";
import { useChromeHidden } from "../../../embed/host-state";

const isDesktop =
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

const TABS: readonly { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "ai-editor", label: "AI Editor", icon: Bot },
  { id: "api-keys", label: "API Keys", icon: Key },
  ...(isDesktop
    ? [{ id: "mcp" as const, label: "MCP", icon: Plug }]
    : []),
];

export const SettingsDialog: React.FC = () => {
  const { settingsOpen, settingsTab: requestedTab, closeSettings, openSettings } = useSettingsStore();
  // With a managed host AI the person has no keys to enter: no API Keys tab.
  const managed = useHostAiStore((state) => state.options?.managed === true);
  const providersHidden = useChromeHidden("aiProviders");
  const preferencesHidden = useChromeHidden("preferences");
  const tabs = TABS.filter(
    (tab) =>
      !((managed || providersHidden) && tab.id === "api-keys") &&
      !(preferencesHidden && tab.id === "general"),
  );
  const settingsTab: SettingsTab =
    (tabs.some((tab) => tab.id === requestedTab) ? requestedTab : tabs[0]?.id) ?? "ai-editor";

  // The dialog is opened from a store action, not a Radix trigger, so track
  // the last control the person used outside any dialog (pointer or keyboard;
  // Safari does not focus a button on click) and give focus back to it on close.
  const lastControl = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const remember = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('[role="dialog"]')) return;
      const control = target.closest<HTMLElement>("button, a[href], input, select, textarea, [tabindex]");
      if (control) lastControl.current = control;
    };
    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("focusin", remember, true);
    return () => {
      document.removeEventListener("pointerdown", remember, true);
      document.removeEventListener("focusin", remember, true);
    };
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !settingsOpen) {
      const target = lastControl.current;
      if (target?.isConnected) {
        const frame = requestAnimationFrame(() => target.focus({ preventScroll: true }));
        wasOpen.current = false;
        return () => cancelAnimationFrame(frame);
      }
    }
    wasOpen.current = settingsOpen;
    return undefined;
  }, [settingsOpen]);

  const setTab = useCallback((tab: SettingsTab) => {
    openSettings(tab);
  }, [openSettings]);

  return (
    <Dialog
      isOpen={settingsOpen}
      onOpenChange={(open) => !open && closeSettings()}
      width={720}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="Settings"
            subtitle={managed ? "Configure editor preferences." : "Configure preferences and manage API keys for external services."}
            onOpenChange={(open) => !open && closeSettings()}
            startContent={<Settings size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="max-h-[min(70vh,calc(100dvh-170px))] overflow-y-auto">
            <Tabs
              value={settingsTab}
              onValueChange={(value) => setTab(value as SettingsTab)}
              className="w-full"
            >
              <TabsList
                aria-label="Settings"
                className="grid h-auto w-full gap-0.5 rounded-[7px] border border-border bg-bg-1 p-0.5"
                layoutId="settings-tabs"
                style={{
                  gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
                }}
              >
                {tabs.map((tab) => {
                  const Icon = tab.icon;

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      onClick={() => setTab(tab.id)}
                      className="h-8 gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold text-fg-muted data-[state=active]:text-fg"
                      aria-controls={`settings-tabpanel-${tab.id}`}
                      id={`settings-tab-${tab.id}`}
                    >
                      <Icon size={14} aria-hidden />
                      <span className="truncate">{tab.label}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            <div
              role="tabpanel"
              id={`settings-tabpanel-${settingsTab}`}
              aria-labelledby={`settings-tab-${settingsTab}`}
              className="mt-4"
            >
              {settingsTab === "general" && <GeneralPanel />}
              {settingsTab === "ai-editor" && <AISettingsPanel />}
              {settingsTab === "api-keys" && <ApiKeysPanel />}
              {settingsTab === "mcp" && <McpPanel />}
            </div>
          </LayoutContent>
        }
      />
    </Dialog>
  );
};
