// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ProjectSwitchRow } from "../panels/EditorProject";
import { ProjectTree } from "../panels/project-tree/project-tree";

const projects = [
  { id: "yard", name: "Yard" },
  { id: "engine", name: "Engine" },
];

afterEach(cleanup);

describe("the Project panel's switcher row", () => {
  it("switches projects on its own, with no project session open", async () => {
    const onChange = vi.fn();
    render(<ProjectSwitchRow choice={{ current: "yard", projects, onChange }} />);
    const trigger = screen.getByRole("combobox", { name: "Open project" });
    expect(trigger.textContent).toContain("Yard");
    fireEvent.click(trigger);
    const engine = await screen.findByRole("option", { name: "Engine" });
    fireEvent.mouseMove(engine);
    fireEvent.click(engine);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("engine"));
  });
});

describe("the project tree's root row", () => {
  it("names the project without a head, and says All files under one", () => {
    const root = () => document.querySelector(".je-ptree-root-name")?.textContent;
    render(<ProjectTree projectId="yard" projectName="Yard" nodes={[]} />);
    expect(root()).toBe("Yard");
    cleanup();
    render(
      <ProjectTree projectId="yard" projectName="Yard" nodes={[]} head={<span>switcher</span>} />,
    );
    expect(root()).toBe("All files");
  });
});
