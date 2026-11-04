// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PortalContainerProvider,
} from "@openreel/ui";

function OpenPopover() {
  return (
    <Popover open>
      <PopoverTrigger>trigger</PopoverTrigger>
      <PopoverContent>menu content</PopoverContent>
    </Popover>
  );
}

describe("portal container", () => {
  afterEach(cleanup);

  it("portals into document.body when no container is provided (standalone app)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(<OpenPopover />, { container: root });
    const content = screen.getByText("menu content");
    expect(root.contains(content)).toBe(false);
    expect(content.closest("body")).toBe(document.body);
    root.remove();
  });

  it("portals into the editor root when a host mounts the editor", () => {
    const editorRoot = document.createElement("div");
    editorRoot.setAttribute("data-openreel-root", "");
    document.body.appendChild(editorRoot);
    render(
      <PortalContainerProvider container={editorRoot}>
        <OpenPopover />
      </PortalContainerProvider>,
    );
    expect(editorRoot.contains(screen.getByText("menu content"))).toBe(true);
    editorRoot.remove();
  });
});
