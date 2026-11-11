import { useState } from "react";

import type { SettingsSection } from "../../../editor/settings-model";
import { GAME_SETTINGS_KIND, INPUT_MAP_KIND, SCENE_LIST_KIND } from "../../../project/index";
import type { EditorNotify } from "../../host";
import { TabPanel, Tabs } from "../../kit/index";
import type { EditorProjectLink } from "../../session/use-scene-editor";
import { EnginePanel } from "./EnginePanel";
import { GeneralPanel } from "./GeneralPanel";
import { InputPanel, type CaptureBinding } from "./InputPanel";
import { LayersPanel } from "./LayersPanel";
import { ScenesPanel } from "./ScenesPanel";
import { useSettingsDoc } from "./settings-doc";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", title: "General" },
  { id: "engine", title: "Engine" },
  { id: "input", title: "Input" },
  { id: "scenes", title: "Scenes" },
  { id: "layers", title: "Layers" },
];

/**
 * The project's settings in five tabs over its game-settings, input-map and
 * scene-list docs (and, read-only, what its code registers). Every edit is
 * one `settingsEdit` batch through the project session, so it has history,
 * per-person undo and sync like any other.
 */
export function ProjectSettings({
  project,
  notify,
  capture,
}: {
  project: EditorProjectLink;
  notify: EditorNotify;
  /** The running game's binding capture; null while there is none. */
  capture: CaptureBinding | null;
}) {
  const [tab, setTab] = useState<string>("general");
  const settings = useSettingsDoc(project, GAME_SETTINGS_KIND, notify);
  const input = useSettingsDoc(project, INPUT_MAP_KIND, notify);
  const scenes = useSettingsDoc(project, SCENE_LIST_KIND, notify);
  const { registry } = project.session;
  return (
    <div className="je-insp-stack" aria-label="Project settings" role="region">
      <Tabs
        value={tab}
        onValueChange={setTab}
        label="Project settings sections"
        items={SETTINGS_SECTIONS.map((s) => ({ value: s.id, label: s.title }))}
      >
        <TabPanel value="general">
          <GeneralPanel doc={settings} registry={registry} />
        </TabPanel>
        <TabPanel value="engine">
          <EnginePanel doc={settings} registry={registry} />
        </TabPanel>
        <TabPanel value="input">
          <InputPanel doc={input} registry={registry} capture={capture} notify={notify} />
        </TabPanel>
        <TabPanel value="scenes">
          <ScenesPanel doc={scenes} />
        </TabPanel>
        <TabPanel value="layers">
          <LayersPanel session={project.session} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
