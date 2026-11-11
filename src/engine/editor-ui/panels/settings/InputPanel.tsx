import { useEffect, useRef, useState } from "react";

import { settingsEdit, settingsRows } from "../../../editor/settings-model";
import { DEFAULT_PLAYERS } from "../../../game/input-bindings";
import type { Binding, Registry } from "../../../game/types";
import { DEFAULT_DEADZONE } from "../../../input/quantize";
import { isPlainObject } from "../../../project/kinds/define";
import type { GameInput } from "../../../types";
import type { EditorNotify } from "../../host";
import { Badge, Button, Hint, MicroLabel, SegmentedControl, Text } from "../../kit/index";
import {
  actionRows,
  addBindingProblem,
  bindingLabel,
  directed,
  DIRECTIONS,
  withBindings,
  type ActionRow,
} from "./bindings";
import { DocGate } from "./DocGate";
import { RemoveButton } from "./RemoveButton";
import { settingScope, type SettingsDoc } from "./settings-doc";
import { inputMapParts } from "./settings-schemas";
import { SettingsNote, SettingsRows } from "./SettingsRows";

/** How "Add binding" asks for a press: the running game's `input.capture`. */
export type CaptureBinding = GameInput["capture"];

const CAPTURE_MS = 8_000;

type InputCtx = {
  doc: SettingsDoc;
  value: Record<string, unknown>;
  registry: Registry;
  capture: CaptureBinding | null;
  notify: EditorNotify;
};

const seatsOf = (value: Record<string, unknown>, registry: Registry) => {
  const players = isPlainObject(value.players) ? value.players : null;
  return typeof players?.max === "number"
    ? players.max
    : (registry.game?.input?.players?.max ?? DEFAULT_PLAYERS.max);
};

const touchIds = (value: Record<string, unknown>): string[] =>
  Array.isArray(value.touch)
    ? value.touch.flatMap((t) => (isPlainObject(t) && typeof t.id === "string" ? [t.id] : []))
    : [];

/** Writes `bindings` as the action's whole list: its entry's, or a new entry the map didn't have. */
function bindOp(ctx: InputCtx, action: string, bindings: readonly Binding[]) {
  const { doc, value } = ctx;
  const current = { doc: value, layout: doc.layout! };
  const listed = Array.isArray(value.actions)
    ? value.actions.some((a) => isPlainObject(a) && a.action === action)
    : false;
  return listed
    ? settingsEdit(doc.entry!.id, `actions.@${action}.bindings`, [...bindings], current)
    : settingsEdit(doc.entry!.id, "actions", withBindings(value, action, bindings), current);
}

function BindingChip({
  ctx,
  row,
  index,
  binding,
}: {
  ctx: InputCtx;
  row: ActionRow;
  index: number;
  binding: Binding;
}) {
  const label = bindingLabel(binding);
  const remove = () =>
    ctx.doc.edit(
      [
        bindOp(
          ctx,
          row.action,
          row.bindings.filter((_, i) => i !== index),
        ),
      ],
      `Remove ${label} from ${row.action}`,
      settingScope(ctx.doc.docName, `actions.${row.action}`),
    );
  return (
    <span className="je-chip">
      {label}
      <RemoveButton
        className="je-chip-remove"
        label={`Remove ${label} from ${row.action}`}
        title={`Remove ${label}?`}
        message={
          row.mapped
            ? `${row.action} stops answering to ${label}.`
            : `${row.action} stops answering to ${label}. The project's input map takes over this action's bindings from the game.`
        }
        disabled={ctx.doc.readOnly !== null}
        onConfirm={remove}
      />
    </span>
  );
}

function ActionLine({ ctx, row }: { ctx: InputCtx; row: ActionRow }) {
  const [waiting, setWaiting] = useState(false);
  const directions = row.kind === "button" ? [] : DIRECTIONS[row.kind];
  const [direction, setDirection] = useState(0);
  const scope = settingScope(ctx.doc.docName, `actions.${row.action}`);
  // The press can come after someone else's edit: the binding joins the doc as it is then.
  const latest = useRef({ ctx, row });
  useEffect(() => {
    latest.current = { ctx, row };
  });
  const add = async () => {
    if (!ctx.capture) return;
    setWaiting(true);
    const captured = await ctx.capture({ timeoutMs: CAPTURE_MS }).finally(() => setWaiting(false));
    if (!captured) return;
    const { ctx: now, row: current } = latest.current;
    const binding = directed(captured, current.kind, directions[direction]);
    const problem = addBindingProblem(current, binding, {
      max: seatsOf(now.value, now.registry),
      controls: touchIds(now.value),
    });
    if (problem) {
      now.notify.warning(`Couldn't bind ${bindingLabel(binding)}`, { description: problem });
      return;
    }
    await now.doc.edit(
      [bindOp(now, current.action, [...current.bindings, binding])],
      `Bind ${bindingLabel(binding)} to ${current.action}`,
      scope,
    );
  };
  return (
    <div className="je-insp-field" role="group" aria-label={row.action}>
      <div className="je-insp-field-label">
        <Hint content={row.description} disabled={!row.description}>
          <span className="je-insp-field-title">{row.action}</span>
        </Hint>
        {row.ui ? (
          <Hint content="UI-only: the game's UI reads it; the simulation and recordings never see it.">
            <Badge size="label" variant="outline">
              UI
            </Badge>
          </Hint>
        ) : null}
      </div>
      <div className="je-insp-field-control">
        <div className="je-chips" aria-label={`${row.action} bindings`}>
          {row.bindings.map((binding, i) => (
            <BindingChip
              key={`${i}:${JSON.stringify(binding)}`}
              ctx={ctx}
              row={row}
              index={i}
              binding={binding}
            />
          ))}
          {row.bindings.length === 0 ? <span className="je-insp-muted">unbound</span> : null}
        </div>
        <div className="je-insp-row" data-gap="tight">
          {directions.length > 0 ? (
            <SegmentedControl
              size="xs"
              aria-label={`${row.action} direction`}
              value={String(direction)}
              onChange={(v) => setDirection(Number(v))}
            >
              {directions.map((d, i) => (
                <SegmentedControl.Item key={d.label} value={String(i)}>
                  {d.label}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            busyScope={scope}
            disabled={ctx.doc.readOnly !== null || !ctx.capture || waiting}
            tooltip={ctx.capture ? undefined : "The game isn't running here yet."}
            onClick={() => void add()}
          >
            {waiting ? "Press a key or button… (Esc cancels)" : "Add binding"}
          </Button>
        </div>
        {!row.mapped ? (
          <span className="je-insp-muted">The game's bindings; editing one copies them here.</span>
        ) : null}
      </div>
    </div>
  );
}

const nextTouchId = (taken: readonly string[]) => {
  let n = taken.length + 1;
  while (taken.includes(`button-${n}`)) n++;
  return `button-${n}`;
};

function TouchControls({ ctx }: { ctx: InputCtx }) {
  const { doc, value, registry } = ctx;
  const { touch } = inputMapParts(registry);
  const controls = Array.isArray(value.touch)
    ? value.touch.filter((t): t is Record<string, unknown> & { id: string } =>
        isPlainObject(t) ? typeof t.id === "string" : false,
      )
    : [];
  const list = (next: unknown[]) =>
    settingsEdit(doc.entry!.id, "touch", next, { doc: value, layout: doc.layout! });
  const firstButton = registry.actions.find((a) => (a.kind ?? "button") === "button");
  const add = () => {
    if (!firstButton) return;
    const id = nextTouchId(controls.map((c) => c.id));
    void doc.edit(
      [
        list([
          ...controls,
          { id, kind: "button", action: firstButton.action, at: [0.85, 0.8], radius: 0.08 },
        ]),
      ],
      `Add touch control ${id}`,
      settingScope(doc.docName, "touch"),
    );
  };
  return (
    <div className="je-insp-stack" aria-label="Touch controls" role="group">
      <MicroLabel>Touch controls</MicroLabel>
      {controls.length === 0 ? <SettingsNote>No on-screen controls.</SettingsNote> : null}
      {controls.map((control) => (
        <div key={control.id} className="je-insp-stack">
          <div className="je-insp-line">
            <Text size="sm">{control.id}</Text>
            <RemoveButton
              label={`Remove ${control.id}`}
              title={`Remove ${control.id}?`}
              message="Touch bindings that name it stop working."
              disabled={doc.readOnly !== null}
              onConfirm={() =>
                doc.edit(
                  [list(controls.filter((c) => c.id !== control.id))],
                  `Remove touch control ${control.id}`,
                  settingScope(doc.docName, "touch"),
                )
              }
            />
          </div>
          <SettingsRows
            doc={doc}
            rows={settingsRows(touch, control, `touch.@${control.id}`, { registry })}
          />
        </div>
      ))}
      <div className="je-insp-line">
        <Button
          size="xs"
          variant="ghost"
          busyScope={settingScope(doc.docName, "touch")}
          disabled={doc.readOnly !== null || !firstButton}
          onClick={add}
        >
          Add touch control
        </Button>
      </div>
    </div>
  );
}

/**
 * The input map: seats and deadzone as rows, every action of the game with
 * its bindings as chips ("Add binding" takes the next press through the
 * running game's capture), and the on-screen controls.
 */
export function InputPanel({
  doc,
  registry,
  capture,
  notify,
}: {
  doc: SettingsDoc;
  registry: Registry;
  capture: CaptureBinding | null;
  notify: EditorNotify;
}) {
  const { seats } = inputMapParts(registry);
  const players = registry.game?.input?.players ?? DEFAULT_PLAYERS;
  return (
    <DocGate doc={doc} noun="input map">
      {(value) => {
        const ctx: InputCtx = { doc, value, registry, capture, notify };
        const rows = actionRows(registry, value);
        return (
          <>
            <SettingsRows
              doc={doc}
              rows={settingsRows(seats, value, "", { registry })}
              fallbacks={{
                "players.max": players.max,
                "players.join": players.join,
                deadzone: registry.game?.input?.deadzone ?? DEFAULT_DEADZONE,
              }}
              fills={{ players }}
            />
            <div className="je-insp-stack" role="group" aria-label="Actions">
              <MicroLabel>Actions</MicroLabel>
              {rows.length === 0 ? (
                <SettingsNote>The game declares no actions.</SettingsNote>
              ) : null}
              {rows.map((row) => (
                <ActionLine key={row.action} ctx={ctx} row={row} />
              ))}
            </div>
            <TouchControls ctx={ctx} />
          </>
        );
      }}
    </DocGate>
  );
}
