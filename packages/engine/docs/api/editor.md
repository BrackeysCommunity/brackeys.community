# @jams/engine/editor

Generated from the packed `.d.mts` files by `scripts/engine-api-docs.ts`; regenerate with `vp run engine:pack && UPDATE_API_DOCS=1 bun scripts/engine-api-docs.ts`. [All entries](README.md)

[`Aabb`](#aabb) · [`ApplyOptions`](#applyoptions) · [`ApplyResult`](#applyresult) · [`AssetDrop`](#assetdrop) · [`BehaviorGizmo`](#behaviorgizmo) · [`BehaviorMarks`](#behaviormarks) · [`BehaviorOption`](#behavioroption) · [`BehaviorSectionId`](#behaviorsectionid) · [`BehaviorSectionInfo`](#behaviorsectioninfo) · [`BulkEntry`](#bulkentry) · [`BulkKey`](#bulkkey) · [`CLOSE_PX`](#close_px) · [`COARSE_NUDGE_STEPS`](#coarse_nudge_steps) · [`CreateVariant`](#createvariant) · [`DEFAULT_CELL`](#default_cell) · [`DEFAULT_DRAW_TYPE`](#default_draw_type) · [`DEFAULT_SNAP`](#default_snap) · [`DRAG_THRESHOLD_PX`](#drag_threshold_px) · [`DRAW_TYPE_COMMAND`](#draw_type_command) · [`DispatchOptions`](#dispatchoptions) · [`DocApplyResult`](#docapplyresult) · [`DragOptions`](#dragoptions) · [`DrawToolKind`](#drawtoolkind) · [`DrawToolOptions`](#drawtooloptions) · [`DrawTypeOption`](#drawtypeoption) · [`DropOptions`](#dropoptions) · [`DropPreview`](#droppreview) · [`ENGINE_KEYS`](#engine_keys) · [`ENGINE_TOOL_IDS`](#engine_tool_ids) · [`EditGeometry`](#editgeometry) · [`EditPose`](#editpose) · [`EditableSpatialIndex`](#editablespatialindex) · [`EditorCommand`](#editorcommand) · [`EditorKeyEvent`](#editorkeyevent) · [`EditorMode`](#editormode) · [`EditorSession`](#editorsession) · [`EditorSessionEvent`](#editorsessionevent) · [`EditorSessionOptions`](#editorsessionoptions) · [`EditorStoreState`](#editorstorestate) · [`EditorTool`](#editortool) · [`EditorToolContext`](#editortoolcontext) · [`EditorToolDef`](#editortooldef) · [`EngineKeyBinding`](#enginekeybinding) · [`EngineToolId`](#enginetoolid) · [`EntityDef`](#entitydef) · [`EntityTypeName`](#entitytypename) · [`EnumOption`](#enumoption) · [`FORCE_PX`](#force_px) · [`FieldWidget`](#fieldwidget) · [`GameEditorDef`](#gameeditordef) · [`GameKeyBinding`](#gamekeybinding) · [`GesturePreview`](#gesturepreview) · [`GesturePreviewOptions`](#gesturepreviewoptions) · [`GizmoEdit`](#gizmoedit) · [`GizmoHandle`](#gizmohandle) · [`GizmoTarget`](#gizmotarget) · [`HANDLE_HIT_PX`](#handle_hit_px) · [`HANDLE_PX`](#handle_px) · [`HandleKind`](#handlekind) · [`History`](#history) · [`HistoryEntry`](#historyentry) · [`HistoryOptions`](#historyoptions) · [`INSPECTOR_SECTIONS`](#inspector_sections) · [`INSTANCES_ROW`](#instances_row) · [`IndexEntry`](#indexentry) · [`InspectorField`](#inspectorfield) · [`InspectorModel`](#inspectormodel) · [`InspectorRow`](#inspectorrow) · [`InspectorSectionId`](#inspectorsectionid) · [`InspectorSectionModel`](#inspectorsectionmodel) · [`InspectorWidgetDef`](#inspectorwidgetdef) · [`InstanceParamsModel`](#instanceparamsmodel) · [`InstanceTransformModel`](#instancetransformmodel) · [`KeyContext`](#keycontext) · [`KeyMatch`](#keymatch) · [`KeyScope`](#keyscope) · [`Keymap`](#keymap) · [`LogEntry`](#logentry) · [`MIN_POINTS`](#min_points) · [`MIN_WAYPOINTS`](#min_waypoints) · [`MULTI_CLICK_MS`](#multi_click_ms) · [`MULTI_CLICK_PX`](#multi_click_px) · [`ModelEdit`](#modeledit) · [`ModelField`](#modelfield) · [`ModelSectionId`](#modelsectionid) · [`NumberBounds`](#numberbounds) · [`OpBatch`](#opbatch) · [`OutlineRow`](#outlinerow) · [`OverlayTone`](#overlaytone) · [`PICK_TOL_PX`](#pick_tol_px) · [`POINT_PICK_PX`](#point_pick_px) · [`ParamModel`](#parammodel) · [`ParseFragmentResult`](#parsefragmentresult) · [`PasteOptions`](#pasteoptions) · [`PasteResult`](#pasteresult) · [`PeerPresence`](#peerpresence) · [`PickLayers`](#picklayers) · [`PickOptions`](#pickoptions) · [`PlacedTemplate`](#placedtemplate) · [`PlacementCheck`](#placementcheck) · [`PlacementEditorToolOptions`](#placementeditortooloptions) · [`PlacementTemplate`](#placementtemplate) · [`PointShape`](#pointshape) · [`PrefabIsolation`](#prefabisolation) · [`PrefabIsolationOptions`](#prefabisolationoptions) · [`PreviewRuntime`](#previewruntime) · [`Pt`](#pt) · [`QuarterTurnTargets`](#quarterturntargets) · [`RESIZE_DIRS`](#resize_dirs) · [`Ref`](#ref) · [`RefTarget`](#reftarget) · [`Registry`](#registry) · [`ResizeDir`](#resizedir) · [`RevertResult`](#revertresult) · [`SECTION_TITLES`](#section_titles) · [`SNAP_PX`](#snap_px) · [`SNAP_REACH_PX`](#snap_reach_px) · [`SNAP_STEPS`](#snap_steps) · [`STALK_PX`](#stalk_px) · [`SceneChange`](#scenechange) · [`SceneDefinition`](#scenedefinition) · [`SceneFragment`](#scenefragment) · [`SceneHash`](#scenehash) · [`SceneIssue`](#sceneissue) · [`SceneOp`](#sceneop) · [`SceneOrigin`](#sceneorigin) · [`ScenePresence`](#scenepresence) · [`SelectMode`](#selectmode) · [`SessionHistory`](#sessionhistory) · [`SettingsRowsOptions`](#settingsrowsoptions) · [`SettingsSection`](#settingssection) · [`ShapeConversion`](#shapeconversion) · [`ShapeObj`](#shapeobj) · [`ShapeSlot`](#shapeslot) · [`ShapeTuple`](#shapetuple) · [`SnapGuide`](#snapguide) · [`SnapMoveInput`](#snapmoveinput) · [`SnapMoveResult`](#snapmoveresult) · [`SnapSettings`](#snapsettings) · [`SnapTarget`](#snaptarget) · [`SpatialIndex`](#spatialindex) · [`SpatialIndexOptions`](#spatialindexoptions) · [`StrokeFit`](#strokefit) · [`ToolHost`](#toolhost) · [`ToolHostOptions`](#toolhostoptions) · [`ToolKeyEvent`](#toolkeyevent) · [`ToolLayers`](#toollayers) · [`ToolModifiers`](#toolmodifiers) · [`ToolOption`](#tooloption) · [`ToolOverlay`](#tooloverlay) · [`ToolPointerEvent`](#toolpointerevent) · [`VELOCITY_PX`](#velocity_px) · [`WHEEL_ZOOM`](#wheel_zoom) · [`applyLevels`](#applylevels) · [`applyToPrefabBatch`](#applytoprefabbatch) · [`asProjectBatch`](#asprojectbatch) · [`attachBatch`](#attachbatch) · [`attachFieldOf`](#attachfieldof) · [`behaviorGizmo`](#behaviorgizmo-1) · [`behaviorHandles`](#behaviorhandles) · [`behaviorMarks`](#behaviormarks-1) · [`boundsCheck`](#boundscheck) · [`boxTool`](#boxtool) · [`buildInspectorModel`](#buildinspectormodel) · [`buildOutline`](#buildoutline) · [`builtinTools`](#builtintools) · [`bulkGeometry`](#bulkgeometry) · [`capsuleLength`](#capsulelength) · [`childOverrides`](#childoverrides) · [`circleTool`](#circletool) · [`convertToChainFix`](#converttochainfix) · [`copySelection`](#copyselection) · [`createDrawTool`](#createdrawtool) · [`createEditorSession`](#createeditorsession) · [`createEditorStore`](#createeditorstore) · [`createGesturePreview`](#creategesturepreview) · [`createHistory`](#createhistory) · [`createKeymap`](#createkeymap) · [`createPenTool`](#createpentool) · [`createPrefabBatch`](#createprefabbatch) · [`createSpatialIndex`](#createspatialindex) · [`createToolHost`](#createtoolhost) · [`createVariantBatch`](#createvariantbatch) · [`cutSelection`](#cutselection) · [`cycleHit`](#cyclehit) · [`defaultLayer`](#defaultlayer) · [`defineEditorTool`](#defineeditortool) · [`deleteBatch`](#deletebatch) · [`deleteVertices`](#deletevertices) · [`dirSigns`](#dirsigns) · [`docRefs`](#docrefs) · [`dragAngle`](#dragangle) · [`dragBehaviorHandle`](#dragbehaviorhandle) · [`dragHandle`](#draghandle) · [`dragInsertVertex`](#draginsertvertex) · [`dragInsertWaypoint`](#draginsertwaypoint) · [`dragSelection`](#dragselection) · [`dragVertex`](#dragvertex) · [`dragWaypoint`](#dragwaypoint) · [`drawBatch`](#drawbatch) · [`drawTypeOptions`](#drawtypeoptions) · [`drawnShape`](#drawnshape) · [`dropBatch`](#dropbatch) · [`dropFragment`](#dropfragment) · [`dropPreview`](#droppreview-1) · [`duplicateSelection`](#duplicateselection) · [`entityGeometry`](#entitygeometry) · [`expandRefs`](#expandrefs) · [`fieldOp`](#fieldop) · [`flipBatch`](#flipbatch) · [`formatMetres`](#formatmetres) · [`fragmentBounds`](#fragmentbounds) · [`fragmentOf`](#fragmentof) · [`geometryOfRef`](#geometryofref) · [`gizmoTarget`](#gizmotarget-1) · [`groupBatch`](#groupbatch) · [`hierarchyDown`](#hierarchydown) · [`hierarchyUp`](#hierarchyup) · [`hitHandle`](#hithandle) · [`insertVertex`](#insertvertex) · [`inspectorFields`](#inspectorfields) · [`instanceOfRef`](#instanceofref) · [`instanceParamsModel`](#instanceparamsmodel-1) · [`instanceTransformModel`](#instancetransformmodel-1) · [`instanceZBatch`](#instancezbatch) · [`instancesOf`](#instancesof) · [`isBulkRef`](#isbulkref) · [`isFollowerType`](#isfollowertype) · [`isolationBounds`](#isolationbounds) · [`judgeConcave`](#judgeconcave) · [`keyChord`](#keychord) · [`labelFor`](#labelfor) · [`lock45`](#lock45) · [`lookupRef`](#lookupref) · [`marqueeSelect`](#marqueeselect) · [`modelBatch`](#modelbatch) · [`modelOps`](#modelops) · [`moveBatch`](#movebatch) · [`moveTarget`](#movetarget) · [`moveVertex`](#movevertex) · [`nestedInstanceOf`](#nestedinstanceof) · [`nextFreeId`](#nextfreeid) · [`nextGroupName`](#nextgroupname) · [`normDeg`](#normdeg) · [`normalizeChord`](#normalizechord) · [`nudgeBatch`](#nudgebatch) · [`nudgeDelta`](#nudgedelta) · [`numberBounds`](#numberbounds-1) · [`onePixel`](#onepixel) · [`openPrefabIsolation`](#openprefabisolation) · [`outlineOrder`](#outlineorder) · [`overridePathsOf`](#overridepathsof) · [`panTool`](#pantool) · [`paramBatch`](#parambatch) · [`parseFragment`](#parsefragment) · [`parseRelative`](#parserelative) · [`pasteFragment`](#pastefragment) · [`pathBatch`](#pathbatch) · [`penTool`](#pentool) · [`pickAt`](#pickat) · [`pixelSize`](#pixelsize) · [`placedShape`](#placedshape) · [`placementEditorTool`](#placementeditortool) · [`pointBatch`](#pointbatch) · [`projectHistory`](#projecthistory) · [`prune`](#prune) · [`quarterTurnTargets`](#quarterturntargets-1) · [`radiusTo`](#radiusto) · [`readAngle`](#readangle) · [`readDelta`](#readdelta) · [`readLength`](#readlength) · [`readPoint`](#readpoint) · [`readRadius`](#readradius) · [`readShapeSize`](#readshapesize) · [`readSize`](#readsize) · [`rebasePath`](#rebasepath) · [`refCandidates`](#refcandidates) · [`referableEntities`](#referableentities) · [`remap`](#remap) · [`removeVertices`](#removevertices) · [`removeWaypoints`](#removewaypoints) · [`resizeBox`](#resizebox) · [`resizeCursor`](#resizecursor) · [`revertAllBatch`](#revertallbatch) · [`revertFieldBatch`](#revertfieldbatch) · [`rotateByHandle`](#rotatebyhandle) · [`rotateSelectionBatch`](#rotateselectionbatch) · [`rotateTargetsBatch`](#rotatetargetsbatch) · [`rotateTool`](#rotatetool) · [`rotationPivot`](#rotationpivot) · [`roundPt`](#roundpt) · [`roundShape`](#roundshape) · [`select`](#select) · [`selectAllRefs`](#selectallrefs) · [`selectTool`](#selecttool) · [`selectionBounds`](#selectionbounds) · [`selectionBox`](#selectionbox) · [`selectionHandles`](#selectionhandles) · [`setHover`](#sethover) · [`settingsEdit`](#settingsedit) · [`settingsRows`](#settingsrows) · [`settingsValue`](#settingsvalue) · [`shapeBatch`](#shapebatch) · [`shapeConversions`](#shapeconversions) · [`shapeEdit`](#shapeedit) · [`shapeHandles`](#shapehandles) · [`shapePivot`](#shapepivot) · [`shapeSet`](#shapeset) · [`shapeSlots`](#shapeslots) · [`snapAngle`](#snapangle) · [`snapDraggedPoint`](#snapdraggedpoint) · [`snapMove`](#snapmove) · [`snapPoint`](#snappoint) · [`snapToGrid`](#snaptogrid) · [`strokeFit`](#strokefit-1) · [`strokeShape`](#strokeshape) · [`takesConcave`](#takesconcave) · [`targetBox`](#targetbox) · [`targetHandles`](#targethandles) · [`targetsOf`](#targetsof) · [`toolKeyEventOf`](#toolkeyeventof) · [`turnBatch`](#turnbatch) · [`ungroupBatch`](#ungroupbatch) · [`unpackBatch`](#unpackbatch) · [`vertexHandles`](#vertexhandles) · [`waypointHandles`](#waypointhandles) · [`waypointsTool`](#waypointstool) · [`withShapeSlot`](#withshapeslot) · [`zOrderBatch`](#zorderbatch)

## `Aabb`

_type_ in `scene/types.ts`

```ts
type Aabb = {
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
};
```

## `ApplyOptions`

_type_ in `scene/types.ts`

```ts
type ApplyOptions = {
    /** The prefab the document is a view of (a prefab doc read as a scene), so an op that nests instances refuses a cycle through it. */
    prefab?: string;
    /** The prefabs instances name; prefab ops read and change it. */
    prefabs?: PrefabLibrary;
    /** The project the scene belongs to: its issues judge asset ids and sprite frames, as `validateScene` does. */
    project?: ProjectView;
    validate?: "none" | "structural";
};
```

## `ApplyResult`

_type_ in `scene/types.ts`

```ts
type ApplyResult = {
    created: string[];
    def: SceneDefinition;
    diff: SceneChange[];
    hash: SceneHash;
    inverse: OpBatch;
    issues: SceneIssue[];
    ok: true;
    /** The library after the batch, when it changed a prefab. */
    prefabs?: PrefabLibrary;
    /** Ids of the prefabs the batch set or deleted. */
    prefabsChanged?: string[];
    /** Start-of-batch refs that now go by another ref, or `null` when removed. */
    remap: Record<Ref, Ref | null>;
    touched: Ref[];
} | {
    failedAt: number;
    hash: SceneHash;
    issue: SceneIssue;
    ok: false;
};
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneChange`](#scenechange), [`SceneDefinition`](#scenedefinition), [`SceneHash`](#scenehash), [`SceneIssue`](#sceneissue).

## `AssetDrop`

_type_ in `editor/asset-drop.ts`

An asset dragged onto the canvas: a texture, an atlas frame (with `frame`) or a prefab.

```ts
type AssetDrop = {
    entry: AssetEntry;
    frame?: string;
    info: AssetInfo;
};
```

## `BehaviorGizmo`

_type_ in `editor/gizmos/behavior-target.ts`

The parts of an entity's standard behaviors its gizmos draw and edit, in
world metres unless a field says otherwise.

```ts
type BehaviorGizmo = {
    /** The `collider` block's shape, as written and placed at the pose; `sensor` when it is a trigger. */
    collider?: {
        local: ShapeObj;
        sensor: boolean;
        world: ShapeObj;
    };
    force?: {
        force: Pt;
        kind: "directional";
    } | {
        kind: "point";
        strength: number;
    };
    joint?: {
        anchorA: Pt;
        /** Only when the block writes `anchorB`. */
        anchorB?: Pt;
        /** The entity `to` names, at its pose; absent when it names nothing in the scene. */
        to?: {
            pose: EditPose;
            ref: Ref;
        };
    };
    pose: EditPose;
    /** `velocity` is local to the pose, m/s. */
    spawner?: {
        spread: number;
        velocity?: Pt;
    };
};
```

Refers to [`EditPose`](#editpose), [`Pt`](#pt), [`Ref`](#ref), [`ShapeObj`](#shapeobj).

## `BehaviorMarks`

_type_ in `editor/gizmos/behavior-marks.ts`

What a selected entity's behavior gizmo draws, world metres; the host draws it under the handles.

```ts
type BehaviorMarks = {
    /** A force area's direction, a spawner's velocity. */
    arrows: {
        from: Pt;
        to: Pt;
    }[];
    /**
     * A joint: `link` from the entity's pose to the entity `to` names, so a
     * joint whose anchors coincide still shows its partner; `anchors` from its
     * anchor to the other body's, when that one is written and apart from it.
     */
    lines: {
        from: Pt;
        kind: "anchors" | "link";
        to: Pt;
    }[];
    /** The collider's shape. */
    outlines: {
        sensor: boolean;
        shape: ShapeObj;
    }[];
    /** A spawner's spread; a point force area's strength, `inward` when it pulls. */
    rings: {
        at: Pt;
        inward?: boolean;
        r: number;
    }[];
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `BehaviorOption`

_type_ in `editor/inspector-model.ts`

A behavior the Add behavior menu offers, with the batch that adds it.

```ts
type BehaviorOption = {
    /** The required behaviors `batch` adds alongside it, by label. */
    adds?: string[];
    /**
     * One update per target that lacks the block. It also adds the behaviors
     * it requires that a target lacks, each from its own template.
     */
    batch: OpBatch;
    /** The behavior's `inspector.category`: its Add behavior heading; a game's own without one list under Game. */
    category?: BehaviorCategory;
    description: string;
    label: string;
    name: BehaviorName;
    /** Why it can't be added yet (a reference with nothing in the scene to name); `batch` would fail. */
    unavailable?: string;
    /** The project assets `batch` names, each with the clip it picked (`hero (idle)`). */
    uses?: string[];
};
```

Refers to [`OpBatch`](#opbatch).

## `BehaviorSectionId`

_type_ in `editor/inspector-model.ts`

A carried behavior's own section.

```ts
type BehaviorSectionId = `behaviors:${BehaviorName}`;
```

## `BehaviorSectionInfo`

_type_ in `editor/inspector-model.ts`

A behavior section's block, and the batch that drops it.

```ts
type BehaviorSectionInfo = {
    description?: string;
    name: BehaviorName;
    /** One update per target removing the block; absent when a target's type requires it. */
    remove?: OpBatch;
};
```

Refers to [`OpBatch`](#opbatch).

## `BulkEntry`

_type_ in `scene/types.ts`

One entry of a bulk array: a shape tuple or a point.

```ts
type BulkEntry = Pt | ShapeTuple;
```

Refers to [`Pt`](#pt), [`ShapeTuple`](#shapetuple).

## `BulkKey`

_type_ in `scene/types.ts`

A top-level array of id-less entries of one type: the type's name, or
`<type>:<material>` for a type whose bulk form takes materials
(`solid:ice`).

```ts
type BulkKey = string;
```

## `CLOSE_PX`

_const_ in `editor/builtin/polyline.ts`

Screen px from the first point that closes a pen stroke.

```ts
declare const CLOSE_PX = 8;
```

## `COARSE_NUDGE_STEPS`

_const_ in `editor/commands.ts`

World px a coarse (Shift) nudge moves.

```ts
declare const COARSE_NUDGE_STEPS = 10;
```

## `CreateVariant`

_type_ in `editor/prefab-commands.ts`

A new variant's batches; `id` is the variant's.

```ts
type CreateVariant = {
    id: AssetId;
    /** One `createAsset`, for `applyProject` (agents, the CLI, the dev file adapter). */
    project: ProjectOpBatch;
    /** The same prefab as a `definePrefab`, for a session that writes prefab docs through its prefab source. */
    scene: OpBatch;
};
```

Refers to [`OpBatch`](#opbatch).

## `DEFAULT_CELL`

_const_ in `editor/spatial-index.ts`

```ts
declare const DEFAULT_CELL = 2.56;
```

## `DEFAULT_DRAW_TYPE`

_const_ in `editor/builtin/draw.ts`

The type the draw tools add unless told otherwise.

```ts
declare const DEFAULT_DRAW_TYPE = "solid";
```

## `DEFAULT_SNAP`

_const_ in `editor/tools.ts`

```ts
declare const DEFAULT_SNAP: SnapSettings;
```

Refers to [`SnapSettings`](#snapsettings).

## `DRAG_THRESHOLD_PX`

_const_ in `editor/builtin/select.ts`

Screen px a press must travel before it becomes a drag.

```ts
declare const DRAG_THRESHOLD_PX = 3;
```

## `DRAW_TYPE_COMMAND`

_const_ in `editor/builtin/draw.ts`

The command prefix that picks a draw tool's type: `type:nav`.

```ts
declare const DRAW_TYPE_COMMAND = "type:";
```

## `DispatchOptions`

_type_ in `editor/session.ts`

```ts
type DispatchOptions = {
    /**
     * The batch was written against `getResolved()` (world coordinates,
     * instance children as `gate-3/door`); it is mapped onto the document
     * with `toSourceBatch` first.
     */
    resolved?: boolean;
    /** Default: the current selection, minus what the batch removed; renames and shifted indices are followed. */
    selectionAfter?: Ref[];
};
```

Refers to [`Ref`](#ref).

## `DocApplyResult`

_type_ in `collab/apply.ts`

What a batch did to the doc, in keys as well as refs.

```ts
type DocApplyResult = (Extract<ApplyResult, {
    ok: true;
}> & {
    /** The prefab docs the batch wrote through `prefabWriter`, in write order. */
    docs: PrefabDocWrite[];
    /** Keys of every entry the batch added, changed or removed. */
    keys: string[];
    /** The key behind each ref of the new document the batch touched or created. */
    refKeys: Record<Ref, string>;
}) | Extract<ApplyResult, {
    ok: false;
}>;
```

Refers to [`ApplyResult`](#applyresult), [`Ref`](#ref).

## `DragOptions`

_type_ in `editor/gizmos/edit.ts`

```ts
type DragOptions = {
    /** Other entities, for geometry snapping of moves, vertices and waypoints. */
    index?: SpatialIndex;
    /** Shift keeps aspect or rotates freely, Alt works from the centre, mod (Ctrl/Cmd) bypasses snapping. */
    mods: ToolModifiers;
    /** The game's px per metre: every edit lands on whole world px. */
    pxPerMetre: number;
    /** Screen px per metre. */
    scale: number;
    snap: SnapSettings;
};
```

Refers to [`SnapSettings`](#snapsettings), [`SpatialIndex`](#spatialindex), [`ToolModifiers`](#toolmodifiers).

## `DrawToolKind`

_type_ in `editor/builtin/draw.ts`

The built-in tools that draw a shape for an entity to hold.

```ts
type DrawToolKind = "box" | "circle" | "pen";
```

## `DrawToolOptions`

_type_ in `editor/builtin/draw.ts`

```ts
type DrawToolOptions = {
    description: string;
    id: string;
    label: string;
    shape: "box" | "circle";
    /** The type drawn shapes become until another is picked; default `solid`. */
    type?: string;
};
```

## `DrawTypeOption`

_type_ in `editor/builtin/draw.ts`

A type a draw tool can add.

```ts
type DrawTypeOption = {
    description: string;
    label: string;
    type: string;
};
```

## `DropOptions`

_type_ in `editor/asset-drop.ts`

```ts
type DropOptions = Parameters<typeof dropBatch>[2];
```

Refers to [`dropBatch`](#dropbatch).

## `DropPreview`

_type_ in `editor/asset-drop.ts`

What dropping an asset here would place, as overlay ghosts.

```ts
type DropPreview = Required<Pick<ToolOverlay, "ghosts">> & Pick<ToolOverlay, "points">;
```

Refers to [`ToolOverlay`](#tooloverlay).

## `ENGINE_KEYS`

_const_ in `editor/keymap.ts`

The editor's own bindings, in the order they're tried within a scope.
Mod is Ctrl or Cmd. Play is Mod+Enter, not Mod+P, which opens the print
dialog.

```ts
declare const ENGINE_KEYS: readonly EngineKeyBinding[];
```

Refers to [`EngineKeyBinding`](#enginekeybinding).

## `ENGINE_TOOL_IDS`

_const_ in `game/types.ts`

The engine's own editor tools; a game's tools can't reuse these ids.

```ts
declare const ENGINE_TOOL_IDS: readonly [
    "select",
    "pan",
    "box",
    "circle",
    "pen",
    "waypoints",
    "rotate"
];
```

## `EditGeometry`

_type_ in `editor/spatial-index.ts`

Where an entity's geometry lives in the document, and what it is in the world.

```ts
type EditGeometry = {
    at?: Pt;
    /** The shape as written: local to the path's first point when there is a path. */
    local?: ShapeObj;
    /** The path runs a closing segment from its last point back to its first. */
    loop?: boolean;
    /** The first path field the entity sets; a shape is local to its first point. */
    pathField?: string;
    /** The first point field the entity sets. */
    pointField?: string;
    /** The path's waypoints, world metres. */
    pts?: Pt[];
    /** The shape in world metres. */
    shape?: ShapeObj;
    /** The first shape field the entity sets. */
    shapeField?: string;
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `EditPose`

_type_ in `editor/gizmos/behavior-target.ts`

Where an entity's blocks are posed: what `shape`, `anchorA`, `force` and `velocity` are local to.

```ts
type EditPose = {
    at: Pt;
    rotDeg: number;
};
```

Refers to [`Pt`](#pt).

## `EditableSpatialIndex`

_type_ in `editor/spatial-index.ts`

```ts
type EditableSpatialIndex = SpatialIndex & {
    /** Indexes `def` from scratch. */
    rebuild(def: SceneDefinition, registry: Registry): void;
    /**
     * Brings the index up to `def` after a change to `touched` (refs of the new
     * document, as `applyOps` and `EditorSession` report them). An empty list
     * rebuilds. A bulk key whose entries changed is re-indexed whole, since its
     * indices shift; entities missing from `def` are dropped.
     */
    update(def: SceneDefinition, registry: Registry, touched: readonly Ref[]): void;
};
```

Refers to [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SpatialIndex`](#spatialindex).

## `EditorCommand`

_type_ in `editor/keymap.ts`

```ts
type EditorCommand = "bring-forward" | "cancel-gesture" | "clear-selection" | "clear-tool" | "copy" | "cut" | "debug" | "delete" | "delete-points" | "duplicate" | "faster" | "flip-x" | "flip-y" | "frame" | "group" | "hierarchy-down" | "hierarchy-up" | "leave-prefab" | "leave-sub-object" | "pan-hold" | "paste" | "pause" | "play" | "play-here" | "redo" | "rotate-ccw" | "rotate-cw" | "save" | "select-all" | "send-backward" | "slower" | "step" | "stop" | "toggle-snap" | "tool:box" | "tool:circle" | "tool:pan" | "tool:pen" | "tool:rotate" | "tool:select" | "tool:waypoints" | "turn-ccw" | "turn-cw" | "undo" | "ungroup" | `nudge-${Direction}-coarse` | `nudge-${Direction}-fine` | `nudge-${Direction}`;
```

## `EditorKeyEvent`

_type_ in `editor/keymap.ts`

```ts
type EditorKeyEvent = {
    altKey: boolean;
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
};
```

## `EditorMode`

_type_ in `editor/store.ts`

```ts
type EditorMode = "edit" | "play";
```

## `EditorSession`

_type_ in `editor/session.ts`

```ts
type EditorSession = {
    destroy(): void;
    dispatch(batch: OpBatch, opts?: DispatchOptions): DocApplyResult;
    doc: Y.Doc;
    /** The project's game-settings `engine` block as it is now, which issues and physical checks resolve settings through; undefined outside a project. */
    engine(): Readonly<Record<string, unknown>> | undefined;
    getDoc(): SceneDefinition;
    getHash(): SceneHash;
    /** The prefabs the session's source holds. */
    getPrefabs(): PrefabLibrary;
    /** The document's resolved view: instances inlined, group offsets applied. What tools draw and pick. */
    getResolved(): SceneDefinition;
    /**
     * The doc key behind a ref, and back; keys stay put while bulk refs shift.
     * An instance child's key is its instance's key, a slash, and the child's
     * id in the prefab.
     */
    keyOf(ref: Ref): string | undefined;
    origin: SceneOrigin;
    /** Set on a session over a prefab doc: the scene size its view centres on. */
    parentBounds?: Bounds;
    /** Where the session's prefabs come from. */
    prefabs: PrefabSource;
    redo(): boolean;
    refOf(key: string): Ref | undefined;
    registry: Registry;
    /** Applies a history entry's inverse as a new batch from this client. */
    revert(entryId: string): RevertResult;
    select(refs: Ref[], mode?: SelectMode, order?: readonly Ref[]): void;
    /** Presence fields besides selection and mode, which the session publishes itself. */
    setCursor(at: Pt | undefined): void;
    setGhost(ghost: ScenePresence["ghost"]): void;
    setMode(mode: EditorMode): void;
    setTool(tool: string): void;
    store: Store<EditorStoreState>;
    subscribe(listener: (e: EditorSessionEvent) => void): () => void;
    /** Undoes this client's last batch only; false when there is none. */
    undo(): boolean;
};
```

Refers to [`DispatchOptions`](#dispatchoptions), [`DocApplyResult`](#docapplyresult), [`EditorMode`](#editormode), [`EditorSessionEvent`](#editorsessionevent), [`EditorStoreState`](#editorstorestate), [`OpBatch`](#opbatch), [`Pt`](#pt), [`Ref`](#ref), [`Registry`](#registry), [`RevertResult`](#revertresult), [`SceneDefinition`](#scenedefinition), [`SceneHash`](#scenehash), [`SceneOrigin`](#sceneorigin), [`ScenePresence`](#scenepresence), [`SelectMode`](#selectmode).

## `EditorSessionEvent`

_type_ in `editor/session.ts`

```ts
type EditorSessionEvent = {
    doc: SceneDefinition;
    /** History entries the change added, oldest first. */
    logged: LogEntry[];
    source: "dispatch" | "redo" | "remote" | "undo";
    /** Refs of the new document that changed; empty for a remote or undo change, which may touch anything. */
    touched: Ref[];
};
```

Refers to [`LogEntry`](#logentry), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `EditorSessionOptions`

_type_ in `editor/session.ts`

```ts
type EditorSessionOptions = {
    /** Presence; without it the session is local-only. */
    awareness?: AwarenessLike;
    /** The shared document; a provider (or a test) keeps it in sync with everyone else's. */
    doc: Y.Doc;
    /** Undo, redo, revert and the history list from elsewhere; the doc's own by default. */
    history?: SessionHistory;
    /** Validation after remote changes waits this long for them to settle. Default 150ms. */
    issuesDebounceMs?: number;
    key?: KeyGen;
    name: string;
    /** This client's origin. Undo tracks this object, so pass the same one for the session's life. */
    origin: SceneOrigin;
    /** On a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
    parentBounds?: Bounds;
    /**
     * Where instances' prefabs come from, and (when it has a writer) where
     * Apply to prefab, Create prefab and Unpack write. Default none, which
     * refuses those ops.
     */
    prefabs?: PrefabSource;
    /** The project the doc belongs to (a `ProjectSession` fits); with it, issues include the doc's asset ids and settings resolve through its engine block. */
    project?: IssueProject;
    /** The types, bulk keys and settings the document is edited against. */
    registry: Registry;
    /** How this client appears to others. */
    user?: ScenePresence["user"];
};
```

Refers to [`Registry`](#registry), [`SceneOrigin`](#sceneorigin), [`ScenePresence`](#scenepresence), [`SessionHistory`](#sessionhistory).

## `EditorStoreState`

_type_ in `editor/store.ts`

What the editor's panels render. Kept apart from the game store, which changes every frame.

```ts
type EditorStoreState = {
    canRedo: boolean;
    canUndo: boolean;
    hash: SceneHash;
    /** The doc's history, oldest first. */
    history: LogEntry[];
    /** The entity under the pointer in the scene view or the outliner, highlighted in both. */
    hover: Ref | null;
    issues: SceneIssue[];
    /** Who made the last change that reached this client. */
    lastActor?: SceneOrigin;
    mode: EditorMode;
    /** Everyone else editing this scene, from awareness. */
    peers: PeerPresence[];
    redoLabel?: string;
    sceneName: string;
    selection: Ref[];
    /** The active tool's id: one of `ENGINE_TOOL_IDS` or a game tool's. */
    tool: string;
    undoLabel?: string;
};
```

Refers to [`EditorMode`](#editormode), [`LogEntry`](#logentry), [`PeerPresence`](#peerpresence), [`Ref`](#ref), [`SceneHash`](#scenehash), [`SceneIssue`](#sceneissue), [`SceneOrigin`](#sceneorigin).

## `EditorTool`

_type_ in `editor/tools.ts`

A live tool. Every hook is optional; returning true claims the event.

```ts
type EditorTool = {
    /** Escape: true when the tool had a gesture or state of its own to drop. */
    cancel?(): boolean;
    /**
     * A command offered to the active tool before the host's default: an
     * engine command (nudge, rotate, delete-points), or the `<arg>` of a game
     * key bound to `tool:<id>:<arg>`.
     */
    command?(command: (string & {}) | EditorCommand): boolean;
    /** A CSS cursor name for the canvas while this tool is active. */
    cursor?(): string | undefined;
    destroy?(): void;
    /** A drag or stroke is in progress; the keymap's gesture context. */
    gesture?(): boolean;
    key?(e: ToolKeyEvent): boolean;
    overlay?(): ToolOverlay;
    pointer?(e: ToolPointerEvent): boolean;
    /** Point editing is on. */
    subObject?(): boolean;
};
```

Refers to [`EditorCommand`](#editorcommand), [`ToolKeyEvent`](#toolkeyevent), [`ToolOverlay`](#tooloverlay), [`ToolPointerEvent`](#toolpointerevent).

## `EditorToolContext`

_type_ in `editor/tools.ts`

What the host gives a tool.

```ts
type EditorToolContext = {
    /** One gesture or stroke as one undoable batch; false when it didn't apply. */
    commit(batch: OpBatch, opts?: {
        selectionAfter?: Ref[];
    }): boolean;
    getDoc(): SceneDefinition;
    /**
     * Reports the entity under the pointer, `null` for none. The host shares
     * it with the outliner and draws its hover outline; absent on a host that
     * shares no hover, where a tool draws its own.
     */
    hover?(ref: Ref | null): void;
    /** Kept current with the doc by the host. */
    index(): SpatialIndex;
    /** Asks the host to draw the overlay again. */
    invalidate(): void;
    /** Layers hidden or locked in this editor; picking skips both. */
    layers(): {
        hidden: ReadonlySet<string>;
        locked: ReadonlySet<string>;
    };
    /** Pans the editor camera by a screen-px drag; absent when the host has no camera. */
    pan?(screenDelta: Pt): void;
    /**
     * Shows a batch without committing it (a drag in progress): the host
     * outlines the selection where the batch puts it; `null` puts it back.
     */
    preview(batch: OpBatch | null): void;
    /** The resolved document as the current preview shows it; `null` with nothing previewed. */
    previewDoc?(): SceneDefinition | null;
    registry: Registry;
    /** Screen px per metre, for tolerances and handle sizes given in screen px. */
    scale(): number;
    select(refs: Ref[], mode?: SelectMode): void;
    selection(): readonly Ref[];
    /** Point editing on one shape, which turns on the keymap's `sub-object` scope. */
    setSubObject(on: boolean): void;
    setTool(id: string): void;
    /** Shares a drag ghost (the keys moving and by how much) with other editors; `undefined` clears it. */
    shareGhost(ghost: undefined | {
        by: Pt;
        keys: string[];
    }): void;
    snap(): SnapSettings;
};
```

Refers to [`OpBatch`](#opbatch), [`Pt`](#pt), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SelectMode`](#selectmode), [`SnapSettings`](#snapsettings), [`SpatialIndex`](#spatialindex).

## `EditorToolDef`

_type_ in `editor/tools.ts`

A tool a game adds. An edit-scope `editorKeys` binding whose command is
`tool:<id>` picks it; `tool:<id>:<arg>` picks it and passes `<arg>` to
its `command`.

```ts
type EditorToolDef = {
    create(ctx: EditorToolContext): EditorTool;
    description: string;
    /** Unique among the engine's (`ENGINE_TOOL_IDS`) and the game's tools. */
    id: string;
    label: string;
};
```

Refers to [`EditorTool`](#editortool), [`EditorToolContext`](#editortoolcontext).

## `EngineKeyBinding`

_type_ in `editor/keymap.ts`

```ts
type EngineKeyBinding = {
    command: EditorCommand;
    description: string;
    /** A chord, as `GameKeyBinding.key` describes. */
    key: string;
    scope: KeyScope;
    /** Applies only when this holds; the next binding for the chord is tried otherwise. */
    when?: (ctx: KeyContext) => boolean;
};
```

Refers to [`EditorCommand`](#editorcommand), [`KeyContext`](#keycontext), [`KeyScope`](#keyscope).

## `EngineToolId`

_type_ in `game/types.ts`

```ts
type EngineToolId = (typeof ENGINE_TOOL_IDS)[number];
```

Refers to [`ENGINE_TOOL_IDS`](#engine_tool_ids).

## `EntityDef`

_type_ in `scene/types.ts`

An entity as written on disk. Its other fields are whatever its type's schema says.

```ts
type EntityDef = EntityBase & {
    [field: string]: unknown;
};
```

## `EntityTypeName`

_type_ in `scene/types.ts`

A registered entity type's name, e.g. `solid`, or a game's own `crate`.

```ts
type EntityTypeName = string;
```

## `EnumOption`

_type_ in `editor/inspector-model.ts`

```ts
type EnumOption = {
    description?: string;
    label: string;
    value: number | string;
};
```

## `FORCE_PX`

_const_ in `editor/gizmos/behavior-target.ts`

Screen px of arrow per m/s² of a force area's `force`, and of ring radius per m/s² of its `strength`.

```ts
declare const FORCE_PX = 4;
```

## `FieldWidget`

_type_ in `editor/inspector-model.ts`

How the site draws a field; the engine only describes it.

```ts
type FieldWidget = {
    accepts: EntityTypeName[];
    any?: true;
    either?: true;
    kind: "entity-ref";
    multiple: boolean;
} | {
    bigStep: number;
    /** Decimals to show: for an `m` field, the ones one world px needs (`lengthDecimals`). */
    decimals?: number;
    /** `min` itself is out of range. */
    exclusiveMin?: boolean;
    integer: boolean;
    kind: "number";
    max?: number;
    min?: number;
    /** Values shown, and typed, as a word (`meta.named`: a repeat's -1 as "forever"). */
    named?: readonly {
        label: string;
        value: number;
    }[];
    /**
     * Shown in `unit` as the stored value times this (a `rad/s` field as
     * `°/s`): the row's value and default are shown values, and what is
     * typed is divided back.
     */
    scale?: number;
    scrub: boolean;
    step: number;
    unit?: string;
} | {
    bigStep: number;
    decimals?: number;
    kind: "range";
    scale?: number;
    step: number;
    unit?: string;
} | {
    bigStep?: number;
    decimals?: number;
    either?: true;
    kind: "point";
    pick: boolean;
    step?: number;
    unit?: string;
} | {
    clip?: FieldPath;
    frame?: FieldPath;
    kind: "asset";
    kinds: AssetKindName[];
} | {
    format: "json" | "text";
    kind: "readonly";
} | {
    id: string;
    kind: "custom";
    widget: InspectorWidgetDef;
} | {
    integer: boolean;
    kind: "angle";
    snapDeg: number;
} | {
    item: string;
    kind: "list";
    max?: number;
    min?: number;
    seed?: unknown;
} | {
    kind: "color";
} | {
    kind: "delay";
    min: number;
    rate: number;
} | {
    kind: "json";
} | {
    kind: "object";
} | {
    kind: "path";
} | {
    kind: "points";
    min?: number;
} | {
    kind: "segmented";
    options: EnumOption[];
} | {
    kind: "select";
    options: EnumOption[];
} | {
    kind: "shape";
    types: ShapeType[];
} | {
    kind: "switch";
} | {
    kind: "tags";
    options?: string[];
    placeholder?: string;
} | {
    kind: "text";
    maxLength?: number;
    pattern?: string;
};
```

Refers to [`EntityTypeName`](#entitytypename), [`EnumOption`](#enumoption), [`InspectorWidgetDef`](#inspectorwidgetdef).

## `GameEditorDef`

_type_ in `game/types.ts`

A game's additions to the editor.

```ts
type GameEditorDef = {
    /** What a dropped asset becomes in this game's scenes; null falls back to the engine's. */
    assetDrop?: (drop: AssetDrop) => EntityInput | InstanceInput | null;
    /**
     * Tools beside the engine's, loaded only when an editor opens (a dynamic
     * `import()`), so editor code never reaches a game's play bundle. A tool
     * is picked by an edit-scope `editorKeys` binding whose command is
     * `tool:<id>`, or by a host button.
     */
    tools?: () => Promise<readonly EditorToolDef[]>;
    /** Widgets by id, as fields name them in `meta.widget`. */
    widgets?: Readonly<Record<string, InspectorWidgetDef>>;
};
```

Refers to [`AssetDrop`](#assetdrop), [`EditorToolDef`](#editortooldef), [`InspectorWidgetDef`](#inspectorwidgetdef).

## `GameKeyBinding`

_type_ in `game/types.ts`

A key the game binds in the editor's keymap (a palette of the game's own
tools). `key` is a chord: optional `Shift+`, `Alt+` and `Mod+` (Ctrl or
Cmd) prefixes, in that order, then a `KeyboardEvent.key` (single
characters lowercase): `"1"`, `"Tab"`, `"Mod+g"`. An engine binding in the
same scope wins and the game's is reported as shadowed.

```ts
type GameKeyBinding = {
    /** Delivered to `GameAttachment.onCommand`. */
    command: string;
    description: string;
    key: string;
    scope: "edit" | "play";
};
```

## `GesturePreview`

_type_ in `editor/gesture.ts`

```ts
type GesturePreview = {
    /** Something is previewed. */
    active(): boolean;
    /** The document as previewed; `null` with nothing previewed. */
    def(): SceneDefinition | null;
    /**
     * Shows `batch` applied to the current document in the runtime, touching
     * only what it changes; `null` puts back whatever the last preview changed,
     * as the document is now. False when the batch doesn't apply (the runtime
     * is put back).
     */
    preview(batch: OpBatch | null): boolean;
};
```

Refers to [`OpBatch`](#opbatch), [`SceneDefinition`](#scenedefinition).

## `GesturePreviewOptions`

_type_ in `editor/gesture.ts`

```ts
type GesturePreviewOptions = {
    /** The committed document, which the runtime mirrors when nothing is previewed. */
    getDoc: () => SceneDefinition;
    registry: Registry;
    runtime?: PreviewRuntime | null;
};
```

Refers to [`PreviewRuntime`](#previewruntime), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `GizmoEdit`

_type_ in `editor/gizmos/edit.ts`

What one gizmo gesture does so far: preview it while dragging, commit `batch` at pointer-up.

```ts
type GizmoEdit = {
    /** A point entity's position as the batch commits it. */
    at?: Pt;
    /** The whole gesture as one batch, on whole world px; `null` when it changes nothing. */
    batch: OpBatch | null;
    /**
     * The edit leaves a poly non-convex. It still commits; afterwards offer
     * **Convert to chain** (`convertToChainFix`). `judgeConcave` clears it for
     * a field that takes concave polygons.
     */
    concave?: boolean;
    guides?: SnapGuide[];
    /** A path's waypoints as the batch commits them. */
    pts?: Pt[];
    /** The drag readout: `Δ 0.64, 0 m`, `W 1.6 H 0.16 m`, `37°`. */
    readout: string;
    /** The shape as the batch commits it, world metres. */
    shape?: ShapeObj;
};
```

Refers to [`OpBatch`](#opbatch), [`Pt`](#pt), [`ShapeObj`](#shapeobj), [`SnapGuide`](#snapguide).

## `GizmoHandle`

_type_ in `editor/tools.ts`

A gizmo handle, drawn at a constant screen size.

```ts
type GizmoHandle = {
    active?: boolean;
    at: Pt;
    /** A CSS cursor name for hover. */
    cursor?: string;
    /** Stable within one gizmo: `resize:nw`, `rotate`, `vertex:3`, `insert:2`, `waypoint:1`. */
    id: string;
    kind: HandleKind;
};
```

Refers to [`HandleKind`](#handlekind), [`Pt`](#pt).

## `GizmoTarget`

_type_ in `editor/gizmos/target.ts`

One selected entity as the gizmos edit it, read from the document.

```ts
type GizmoTarget = {
    /** A point entity's position, when it has no shape. */
    at?: Pt;
    /** Its collider, joint, force area and spawner, when it carries any. */
    behaviors?: BehaviorGizmo;
    bulk: boolean;
    /** The shape as the document holds it: local to the path's first point when there is a path. */
    local?: ShapeObj;
    /** The path the shape rides, waypoints in world metres. */
    path?: {
        field: string;
        loop: boolean;
        pts: Pt[];
    };
    pointField?: string;
    ref: Ref;
    /** The shape in world metres; on a path, placed at the path's first point. */
    shape?: ShapeObj;
    shapeField?: string;
    type: string;
};
```

Refers to [`BehaviorGizmo`](#behaviorgizmo), [`Pt`](#pt), [`Ref`](#ref), [`ShapeObj`](#shapeobj).

## `HANDLE_HIT_PX`

_const_ in `editor/gizmos/handles.ts`

Screen px from a handle's centre that still grabs it.

```ts
declare const HANDLE_HIT_PX = 6;
```

## `HANDLE_PX`

_const_ in `editor/gizmos/handles.ts`

A handle's drawn side, screen px.

```ts
declare const HANDLE_PX = 8;
```

## `HandleKind`

_type_ in `editor/tools.ts`

```ts
type HandleKind = "insert" | "length" | "move" | "radius" | "resize" | "rotate" | "vertex" | "waypoint";
```

## `History`

_type_ in `editor/history.ts`

```ts
type History = {
    canRedo(): boolean;
    canUndo(): boolean;
    clear(): void;
    entries(): readonly HistoryEntry[];
    isDirty(): boolean;
    markSaved(): void;
    peekRedo(): HistoryEntry | null;
    peekUndo(): HistoryEntry | null;
    push(entry: Omit<HistoryEntry, "at"> & {
        at?: number;
    }): void;
    /** Steps forward and returns the entry to re-apply, or null at the end. */
    redo(): HistoryEntry | null;
    redoLabel(): string | undefined;
    /** Steps back and returns the entry to revert, or null at the start. */
    undo(): HistoryEntry | null;
    undoLabel(): string | undefined;
};
```

Refers to [`HistoryEntry`](#historyentry).

## `HistoryEntry`

_type_ in `editor/history.ts`

```ts
type HistoryEntry = {
    /** "human", "agent", or a named agent. */
    actor: string;
    at: number;
    batch: OpBatch;
    inverse: OpBatch;
    label: string;
    selectionAfter: Ref[];
    selectionBefore: Ref[];
    touched: Ref[];
};
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref).

## `HistoryOptions`

_type_ in `editor/history.ts`

```ts
type HistoryOptions = {
    cap?: number;
    coalesceMs?: number;
    now?: () => number;
};
```

## `INSPECTOR_SECTIONS`

_const_ in `editor/inspector-model.ts`

```ts
declare const INSPECTOR_SECTIONS: readonly [
    "identity",
    "transform",
    "shape",
    "behavior",
    "assets",
    "path",
    "physics",
    "overrides"
];
```

## `INSTANCES_ROW`

_const_ in `editor/outline.ts`

The type row instances sit under.

```ts
declare const INSTANCES_ROW = "instances";
```

## `IndexEntry`

_type_ in `editor/tools.ts`

One entry of the spatial index: a ref, its world AABB and what picking needs to know about it.

```ts
type IndexEntry = {
    aabb: Aabb;
    /** The entity's geometry: a shape, or a point for point entities. */
    geometry: Pt | ShapeObj;
    /** The doc key, which stays put while bulk refs shift; the ref for a plain definition. */
    key: string;
    /** A registry layer's name. */
    layer: string;
    ref: Ref;
    /** The world box the entity's sprite draws, when it has one. */
    sprite?: ShapeObj;
    type: string;
    /** Draw order: higher is on top. The registry's layer order first, then `z`, then document order. */
    z: number;
};
```

Refers to [`Aabb`](#aabb), [`Pt`](#pt), [`Ref`](#ref), [`ShapeObj`](#shapeobj).

## `InspectorField`

_type_ in `editor/inspector.ts`

```ts
type InspectorField = (FieldBase & {
    /** `min` itself is out of range. */
    exclusive?: boolean;
    integer: boolean;
    kind: "number";
    max?: number;
    min?: number;
    value: number | undefined;
}) | (FieldBase & {
    fields: InspectorField[];
    kind: "object";
}) | (FieldBase & {
    kind: "point";
    value: Pt | undefined;
}) | (FieldBase & {
    kind: "points";
    value: Pt[];
}) | (FieldBase & {
    kind: "shape";
    slots: ShapeSlot[] | null;
    value: ShapeTuple;
}) | (FieldBase & {
    kind: "value";
    value: unknown;
});
```

Refers to [`Pt`](#pt), [`ShapeSlot`](#shapeslot), [`ShapeTuple`](#shapetuple).

## `InspectorModel`

_type_ in `editor/inspector-model.ts`

```ts
type InspectorModel = {
    /** What Add behavior lists: behaviors every target's type allows and not every target carries. */
    addBehaviors: BehaviorOption[];
    refs: Ref[];
    sections: InspectorSectionModel[];
    /** The selection's types, in first-seen order. */
    types: EntityTypeName[];
};
```

Refers to [`BehaviorOption`](#behavioroption), [`EntityTypeName`](#entitytypename), [`InspectorSectionModel`](#inspectorsectionmodel), [`Ref`](#ref).

## `InspectorRow`

_type_ in `editor/inspector-model.ts`

One field as any schema-driven form draws it: the scene inspector's fields and the settings panels' rows.

```ts
type InspectorRow = {
    /** A path's or an object's fields, paths prefixed with this one's. */
    children?: InspectorRow[];
    /** What an unset field takes: a behavior's or the type's default, else the schema's `meta.default`. */
    defaultValue?: unknown;
    /** The field's `.describe()` text: the tooltip, and what an agent reads in the JSON Schema. */
    description?: string;
    /** The targets disagree; the site shows "—". */
    mixed: boolean;
    /** The field's own key. */
    name: string;
    optional: boolean;
    /** Dot path from the root of the entity or doc, as an update op's `set` or `settingsEdit` takes it. */
    path: FieldPath;
    /** `meta.placeholder`: what an unset field without one fixed default falls back to, in words. */
    placeholder?: string;
    /** Shown, not edited here: the id (renamed with the `rename` op), the type, computed values. */
    readonly: boolean;
    /** What a draft must pass before it commits. */
    schema: z.ZodType;
    /** `meta.title`, else the key in sentence case (`fieldTitle`). */
    title: string;
    /** The value every target shares; undefined when unset or `mixed`. */
    value: unknown;
    widget: FieldWidget;
};
```

Refers to [`FieldWidget`](#fieldwidget).

## `InspectorSectionId`

_type_ in `editor/inspector-model.ts`

```ts
type InspectorSectionId = (typeof INSPECTOR_SECTIONS)[number];
```

Refers to [`INSPECTOR_SECTIONS`](#inspector_sections).

## `InspectorSectionModel`

_type_ in `editor/inspector-model.ts`

```ts
type InspectorSectionModel = {
    /** Set on a `behaviors:<name>` section. */
    behavior?: BehaviorSectionInfo;
    fields: ModelField[];
    id: ModelSectionId;
    title: string;
};
```

Refers to [`BehaviorSectionInfo`](#behaviorsectioninfo), [`ModelField`](#modelfield), [`ModelSectionId`](#modelsectionid).

## `InspectorWidgetDef`

_type_ in `game/types.ts`

How the inspector draws a field a game marks with `.meta({ widget: id })`.
The engine only describes the widget and the site renders it, so a game
never ships UI code (React stays in the site).

```ts
type InspectorWidgetDef = {
    format?: "json" | "text";
    kind: "readonly";
} | {
    kind: "choice";
    options: readonly {
        description?: string;
        label: string;
        value: number | string;
    }[];
} | {
    kind: "color";
} | {
    kind: "slider";
    max: number;
    min: number;
    step?: number;
    unit?: string;
};
```

## `InstanceParamsModel`

_type_ in `editor/inspector-model.ts`

```ts
type InstanceParamsModel = {
    /** The scene instance the values are written on. */
    instance: string;
    /** For a nested instance, its path inside `instance` (`door-1`). */
    nested?: string;
    params: ParamModel[];
    ref: Ref;
    /** The instance as a target `modelOps` reads `params.<name>` from. */
    target: RefTarget;
};
```

Refers to [`ParamModel`](#parammodel), [`Ref`](#ref), [`RefTarget`](#reftarget).

## `InstanceTransformModel`

_type_ in `editor/inspector-model.ts`

How an instance sits: its quarter turns, mirror and `z`, as the instance panel shows them.

```ts
type InstanceTransformModel = {
    /** A scene instance turns, flips and takes a `z`; one nested in another shows its prefab's. */
    editable: boolean;
    flip: boolean;
    ref: Ref;
    /** Quarter turns clockwise, 0–3. */
    rot: 0 | 1 | 2 | 3;
    /** The instance's `z`; 0 when it sets none. */
    z: number;
};
```

Refers to [`Ref`](#ref).

## `KeyContext`

_type_ in `editor/keymap.ts`

What decides the active scopes and Escape's cascade.

```ts
type KeyContext = {
    /** Focus is in a text field, select or contenteditable. */
    editableTarget: boolean;
    /** A drag or draw is in progress. */
    gesture?: boolean;
    /** Something is selected; Escape clears it before leaving a prefab. */
    hasSelection?: boolean;
    /** A prefab is open on its own, so Escape can leave it. */
    inPrefab?: boolean;
    mode: EditorMode;
    /** Everything selected is prefab instances or whole groups, which turn by quarter turns. */
    quarterTurns?: boolean;
    /** A shape's points are being edited. */
    subObject?: boolean;
    /** The active tool; anything but `select` is cleared by Escape. */
    tool?: string;
};
```

Refers to [`EditorMode`](#editormode).

## `KeyMatch`

_type_ in `editor/keymap.ts`

```ts
type KeyMatch = {
    binding: EngineKeyBinding;
    command: EditorCommand;
    source: "engine";
} | {
    binding: GameKeyBinding;
    command: string;
    source: "game";
};
```

Refers to [`EditorCommand`](#editorcommand), [`EngineKeyBinding`](#enginekeybinding), [`GameKeyBinding`](#gamekeybinding).

## `KeyScope`

_type_ in `editor/keymap.ts`

Where a binding applies. `global` holds in edit and play; `sub-object`
(editing a shape's points) sits over `edit`; `text-field` is focus in a
field, where only Mod+S is caught and every other key is typing.

```ts
type KeyScope = "edit" | "global" | "play" | "sub-object" | "text-field";
```

## `Keymap`

_type_ in `editor/keymap.ts`

```ts
type Keymap = {
    /** The engine's bindings, then the game's that apply, for hints and help. */
    bindings: readonly (EngineKeyBinding | GameKeyBinding)[];
    /** The first chord bound to an engine command, for hints. */
    chordOf(command: EditorCommand): string | undefined;
    /** The command for a key press, or null when nothing in the active scopes binds it. */
    resolve(e: EditorKeyEvent, ctx: KeyContext): KeyMatch | null;
    /** Game bindings that collide with an engine binding in their scope (or a global one); they never fire. */
    shadowed: readonly GameKeyBinding[];
};
```

Refers to [`EditorCommand`](#editorcommand), [`EditorKeyEvent`](#editorkeyevent), [`EngineKeyBinding`](#enginekeybinding), [`GameKeyBinding`](#gamekeybinding), [`KeyContext`](#keycontext), [`KeyMatch`](#keymatch).

## `LogEntry`

_type_ in `collab/types.ts`

One batch, as every client's history shows it. `before` holds each touched
key's state before the batch (`null`: it didn't exist) and `after` a
fingerprint of its state after (`null`: removed), so Revert can restore
`before` once it has checked nothing changed since. An entry too large to
keep whole drops both and can't be reverted.

```ts
type LogEntry = {
    actor: DocOrigin;
    after?: Record<string, null | string>;
    /** ms since the epoch, the writer's clock. */
    at: number;
    before?: Record<string, unknown>;
    id: string;
    keys: string[];
    /** `undo`, `redo` or `revert` when the entry records one of those rather than a batch. */
    kind?: "batch" | "redo" | "revert" | "undo";
    label: string;
    ops?: SceneOp["op"][];
    /** What a migration left as it was, and why. Notes, never issue codes. */
    warnings?: LogWarning[];
};
```

Refers to [`SceneOp`](#sceneop).

## `MIN_POINTS`

_const_ in `editor/gizmos/vertices.ts`

The fewest points each outline keeps: a poly 3, a chain 2.

```ts
declare const MIN_POINTS: {
    readonly chain: 2;
    readonly poly: 3;
};
```

## `MIN_WAYPOINTS`

_const_ in `editor/gizmos/waypoints.ts`

The fewest waypoints a path keeps.

```ts
declare const MIN_WAYPOINTS = 2;
```

## `MULTI_CLICK_MS`

_const_ in `editor/tool-host.ts`

Presses this close in time (ms) and space (screen px) count as one multi-click.

```ts
declare const MULTI_CLICK_MS = 500;
```

## `MULTI_CLICK_PX`

_const_ in `editor/tool-host.ts`

```ts
declare const MULTI_CLICK_PX = 5;
```

## `ModelEdit`

_type_ in `editor/inspector-model.ts`

```ts
type ModelEdit = {
    error: string;
    ok: false;
} | {
    ok: true;
    ops: SceneOp[];
};
```

Refers to [`SceneOp`](#sceneop).

## `ModelField`

_type_ in `editor/inspector-model.ts`

An inspector row placed in a section of the scene inspector.

```ts
type ModelField = Omit<InspectorRow, "children"> & {
    children?: ModelField[];
    /** A behavior field's `meta.group` (`jump`, `surface`): the sub-heading the inspector puts it under. */
    group?: string;
    section: ModelSectionId;
};
```

Refers to [`InspectorRow`](#inspectorrow), [`ModelSectionId`](#modelsectionid).

## `ModelSectionId`

_type_ in `editor/inspector-model.ts`

```ts
type ModelSectionId = BehaviorSectionId | InspectorSectionId;
```

Refers to [`BehaviorSectionId`](#behaviorsectionid), [`InspectorSectionId`](#inspectorsectionid).

## `NumberBounds`

_type_ in `editor/inspector.ts`

```ts
type NumberBounds = {
    exclusive?: boolean;
    integer: boolean;
    max?: number;
    min?: number;
};
```

## `OpBatch`

_type_ in `scene/types.ts`

`actor` is "human", "agent", or a named agent.

```ts
type OpBatch = {
    actor?: string;
    base?: SceneHash;
    label?: string;
    ops: SceneOp[];
};
```

Refers to [`SceneHash`](#scenehash), [`SceneOp`](#sceneop).

## `OutlineRow`

_type_ in `editor/outline.ts`

```ts
type OutlineRow = {
    count?: number;
    depth: number;
    /** Secondary text, such as `box · ice`. */
    detail?: string;
    /** Unique within one outline; stable across edits that keep the row. */
    key: string;
    kind: "bucket" | "entity" | "type";
    label: string;
    /** On an instance's row, how many overrides it holds (a nested one's: the scene's keys on it and below); on a child's, whether any of its fields is overridden. */
    overrides?: number;
    /** On an instance's row, a nested one's too: the prefab it places. */
    prefab?: string;
    ref?: Ref;
    type?: EntityTypeName;
};
```

Refers to [`EntityTypeName`](#entitytypename), [`Ref`](#ref).

## `OverlayTone`

_type_ in `editor/tools.ts`

```ts
type OverlayTone = "ghost" | "guide" | "hover" | "invalid" | "selected";
```

## `PICK_TOL_PX`

_const_ in `editor/builtin/polyline.ts`

Screen px of slack when a click picks an entity.

```ts
declare const PICK_TOL_PX = 4;
```

## `POINT_PICK_PX`

_const_ in `editor/picking.ts`

Screen px around a point entity that still picks it.

```ts
declare const POINT_PICK_PX = 8;
```

## `ParamModel`

_type_ in `editor/inspector-model.ts`

One exposed parameter of an instance's prefab, as the instance panel edits it.

```ts
type ParamModel = {
    description: string;
    /**
     * Its value as a field at `params.<name>`, drawn by its first target's
     * schema; `defaultValue` is the param's default, else what that target
     * holds without it.
     */
    field: ModelField;
    name: string;
    /** The instance sets it (for a nested instance: an override on the scene instance does). */
    set: boolean;
    targets: readonly OverridePath[];
};
```

Refers to [`ModelField`](#modelfield).

## `ParseFragmentResult`

_type_ in `scene/fragment.ts`

```ts
type ParseFragmentResult = {
    fragment: SceneFragment;
    issues: SceneIssue[];
    migratedFrom?: number;
    ok: true;
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`SceneFragment`](#scenefragment), [`SceneIssue`](#sceneissue).

## `PasteOptions`

_type_ in `editor/clipboard.ts`

```ts
type PasteOptions = {
    /** Centre the fragment's box here (the cursor, world metres). Omitted, it keeps its own position. */
    at?: Pt;
    def: SceneDefinition;
    /** Added after centring, metres on whole world px, e.g. one grid step for duplicate. */
    offset?: Pt;
    /** The project's prefabs: a pasted instance needs its prefab here, and its box counts in centring. */
    prefabs?: PrefabLibrary;
    registry: Registry;
    /** Grid snapping for `at`: the move is a whole number of grid steps, so grid-aligned pieces stay aligned. */
    snap?: SnapSettings;
};
```

Refers to [`Pt`](#pt), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SnapSettings`](#snapsettings).

## `PasteResult`

_type_ in `editor/clipboard.ts`

```ts
type PasteResult = {
    batch: OpBatch;
    issues: SceneIssue[];
    ok: true;
    select: Ref[];
} | {
    issues: SceneIssue[];
    ok: false;
};
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneIssue`](#sceneissue).

## `PeerPresence`

_type_ in `collab/presence.ts`

```ts
type PeerPresence = ScenePresence & {
    clientId: number;
};
```

Refers to [`ScenePresence`](#scenepresence).

## `PickLayers`

_type_ in `editor/picking.ts`

Layers picking skips.

```ts
type PickLayers = {
    hidden: ReadonlySet<string>;
    locked: ReadonlySet<string>;
};
```

## `PickOptions`

_type_ in `editor/picking.ts`

```ts
type PickOptions = {
    layers?: PickLayers;
    /** Screen px around a point entity that picks it; default `POINT_PICK_PX`, never less than `tolPx`. */
    pointPx?: number;
    /** Screen px per metre. */
    scale: number;
    /** Screen px of slack around shapes. */
    tolPx: number;
};
```

Refers to [`PickLayers`](#picklayers).

## `PlacedTemplate`

_type_ in `editor/placement.ts`

A ghost as the editor places it: whole world px and degrees, and its world shape in metres.

```ts
type PlacedTemplate<T> = {
    at: Pt;
    rotDeg: number;
    shape: ShapeObj;
    template: T;
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `PlacementCheck`

_type_ in `placement.ts`

```ts
type PlacementCheck = {
    reason?: string;
    valid: boolean;
};
```

## `PlacementEditorToolOptions`

_type_ in `editor/placement.ts`

```ts
type PlacementEditorToolOptions<T extends PlacementTemplate> = {
    description: string;
    id: string;
    label: string;
    templates: readonly T[];
    /** The entity a placement adds, at a centre on whole world px (metres) and a whole-degree rotation. */
    toEntity(template: T, at: Pt, rotDeg: number, ctx: EditorToolContext): EntityInput;
    /**
     * A game's warnings beside the engine's bounds check (a spawn overlap).
     * Only a warning: an invalid result marks the ghost, and the placement
     * still commits, because gameplay rules belong to play, not the editor.
     */
    validate?(placed: PlacedTemplate<T>, ctx: EditorToolContext): PlacementCheck;
};
```

Refers to [`EditorToolContext`](#editortoolcontext), [`PlacedTemplate`](#placedtemplate), [`PlacementCheck`](#placementcheck), [`PlacementTemplate`](#placementtemplate), [`Pt`](#pt).

## `PlacementTemplate`

_type_ in `editor/placement.ts`

Something an editor placement tool places: its outline in its own frame, centred on 0, 0.

```ts
type PlacementTemplate = {
    /** What `tool:<toolId>:<id>` picks; also the stem of the placed entity's id (`bounce_pad` → `bounce-pad-2`). */
    id: string;
    label: string;
    rotatable?: boolean;
    shape: ShapeObj;
    style?: Style;
};
```

Refers to [`ShapeObj`](#shapeobj).

## `PointShape`

_type_ in `editor/gizmos/vertices.ts`

```ts
type PointShape = Extract<ShapeObj, {
    type: "chain" | "poly";
}>;
```

Refers to [`ShapeObj`](#shapeobj).

## `PrefabIsolation`

_type_ in `editor/isolation.ts`

```ts
type PrefabIsolation = {
    close(): void;
    prefab: string;
    /** The scene's session the prefab was opened from. */
    scene: EditorSession;
    /** An editor on the prefab's own doc, at its local coordinates. */
    session: EditorSession;
};
```

Refers to [`EditorSession`](#editorsession).

## `PrefabIsolationOptions`

_type_ in `editor/isolation.ts`

```ts
type PrefabIsolationOptions = {
    /** Presence in the prefab's doc; default the project session's awareness of that doc, when there is one. */
    awareness?: AwarenessLike;
    /** Undo and history; default the project's (one stack with the scene) over a session source, else the doc's own. */
    history?: SessionHistory;
    issuesDebounceMs?: number;
    key?: KeyGen;
    /**
     * The prefab was deleted (by a collaborator, an undo, the file); the
     * isolation has already closed itself.
     */
    onGone?: () => void;
    user?: ScenePresence["user"];
};
```

Refers to [`ScenePresence`](#scenepresence), [`SessionHistory`](#sessionhistory).

## `PreviewRuntime`

_type_ in `editor/gesture.ts`

The part of the edit world's runtime a preview drives; `add` and `remove` only for batches that add or delete.

```ts
type PreviewRuntime = {
    add?(entities: RuntimeEntity[]): unknown;
    remove?(ids: string[]): void;
    update(entities: RuntimeEntity[]): unknown;
};
```

## `Pt`

_type_ in `scene/types.ts`

A point in world metres; y is down.

```ts
type Pt = [
    x: number,
    y: number
];
```

## `QuarterTurnTargets`

_type_ in `editor/commands.ts`

```ts
type QuarterTurnTargets = {
    /** Declared groups every member of which is selected, in declaration order. */
    groups: string[];
    /** Selected instances (by id, or through a child) outside the groups below, in selection order. */
    instances: string[];
    /** What neither covers: plain entities and bulk entries. */
    rest: Ref[];
};
```

Refers to [`Ref`](#ref).

## `RESIZE_DIRS`

_const_ in `editor/gizmos/handles.ts`

Resize directions, in a box's own frame: `n` is its top (local -y).

```ts
declare const RESIZE_DIRS: readonly [
    "nw",
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w"
];
```

## `Ref`

_type_ in `scene/types.ts`

An entity id, or a bulk reference `~<bulkKey>:<index>`, e.g. `~solid:ice:3`.

```ts
type Ref = string;
```

## `RefTarget`

_type_ in `editor/refs.ts`

```ts
type RefTarget = {
    entity: EntityDef;
    index: number;
    kind: "entity";
    ref: Ref;
} | {
    index: number;
    key: BulkKey;
    kind: "bulk";
    ref: Ref;
    value: BulkEntry;
};
```

Refers to [`BulkEntry`](#bulkentry), [`BulkKey`](#bulkkey), [`EntityDef`](#entitydef), [`Ref`](#ref).

## `Registry`

_type_ in `game/types.ts`

Primitives plus one game's types, materials, actions, groups and codes.

```ts
type Registry = {
    actionNames: readonly string[];
    actions: readonly ActionDef[];
    /** Registration order: what attach, step and detach follow. */
    behaviorNames: readonly BehaviorName[];
    behaviorRules: (type: EntityTypeName) => BehaviorRules;
    /** The engine's behaviors, then the game's. */
    behaviors: ReadonlyMap<BehaviorName, RegisteredBehavior>;
    bulkKey: (key: BulkKey) => BulkKeyInfo | undefined;
    /** Every bulk key, in spawn order, a type's plain key before its material keys. */
    bulkKeys: readonly BulkKeyInfo[];
    /** `ENGINE_CHECK_KINDS`, then the game's `checks` keys. */
    checkKinds: readonly string[];
    collisionGroupNames: readonly string[];
    /** Packed Rapier `InteractionGroups` for a group name; throws on an unknown one. */
    collisionGroups: (name: string) => number;
    commandNames: readonly string[];
    /** `ENGINE_COMMANDS`, then the game's `commands`. */
    commands: ReadonlyMap<string, CommandDef>;
    game: GameDefinition | null;
    /** The game's id, or `engine` without one. */
    id: string;
    /** The engine's codes, then the game's. */
    issueCodes: Readonly<Record<string, IssueCodeInfo>>;
    /** Scene layers, bottom to top: the game's, or `DEFAULT_LAYERS`. */
    layers: readonly SceneLayerDef[];
    materialNames: readonly string[];
    materials: ReadonlyMap<string, MaterialDef>;
    /** The game's physical checks; the engine's own run first and aren't listed. */
    physicalChecks: readonly PhysicalCheck[];
    /** `ENGINE_PREDICATES`, then the game's `play.predicates` keys. */
    predicateNames: readonly string[];
    /** The game's `prefabContract` fields; empty without a game or one that declares none. */
    prefabContract: z.ZodRawShape;
    /** The primitives-only registry: itself without a game, else built once beside it. */
    primitives: Registry;
    /** `ENGINE_RUN_RESULTS`, then the game's `play.results`. */
    runResults: readonly string[];
    /** `urn:jams-engine:scene:v<SCENE_FORMAT_VERSION>`, or `urn:jams-engine:scene:<game>:v<SCENE_FORMAT_VERSION>`. */
    schemaId: string;
    /** The engine's settings fields plus the game's. */
    settings: z.ZodRawShape;
    /** The index into `spawnGroups` of a loadable type; undefined for one that never loads. */
    spawnGroupOf: (type: EntityTypeName) => number | undefined;
    spawnGroups: readonly (readonly EntityTypeName[])[];
    /** The game's time model before project overrides, else the engine default. */
    time: TimeModel;
    typeNames: readonly EntityTypeName[];
    /** Primitives first, then the game's types, in registration order. */
    types: ReadonlyMap<EntityTypeName, RegisteredType>;
    /** The actions marked `ui: true`, in registration order; `actionNames` lists them too. */
    uiActionNames: readonly string[];
    validators: readonly SceneValidator[];
    /** The game's inspector widgets by id. */
    widgets: ReadonlyMap<string, InspectorWidgetDef>;
};
```

Refers to [`BulkKey`](#bulkkey), [`EntityTypeName`](#entitytypename), [`InspectorWidgetDef`](#inspectorwidgetdef).

## `ResizeDir`

_type_ in `editor/gizmos/handles.ts`

```ts
type ResizeDir = (typeof RESIZE_DIRS)[number];
```

Refers to [`RESIZE_DIRS`](#resize_dirs).

## `RevertResult`

_type_ in `collab/revert.ts`

```ts
type RevertResult = {
    issue: SceneIssue;
    ok: false;
} | {
    keys: string[];
    ok: true;
};
```

Refers to [`SceneIssue`](#sceneissue).

## `SECTION_TITLES`

_const_ in `editor/inspector-model.ts`

```ts
declare const SECTION_TITLES: Readonly<Record<InspectorSectionId, string>>;
```

Refers to [`InspectorSectionId`](#inspectorsectionid).

## `SNAP_PX`

_const_ in `editor/snap.ts`

How close, in screen px, another entity's edge, vertex or centre must be to pull a drag onto it.

```ts
declare const SNAP_PX = 8;
```

## `SNAP_REACH_PX`

_const_ in `editor/snap.ts`

How far, in screen px beyond the moved box, snapping looks for other entities when no `view` is given.

```ts
declare const SNAP_REACH_PX = 128;
```

## `SNAP_STEPS`

_const_ in `editor/tools.ts`

The grid steps in metres; each is whole world px at any px per metre divisible by 4.

```ts
declare const SNAP_STEPS: readonly [
    0.25,
    0.5,
    1,
    2,
    4
];
```

## `STALK_PX`

_const_ in `editor/gizmos/handles.ts`

Screen px from the shape to the rotate handle at the end of its stalk.

```ts
declare const STALK_PX = 24;
```

## `SceneChange`

_type_ in `scene/types.ts`

```ts
type SceneChange = {
    by: Pt;
    kind: "moved";
    ref: Ref;
} | {
    field: "assets" | "bounds" | "game" | "name" | "v" | `groups.${string}` | `settings.${string}`;
    from: unknown;
    kind: "scene";
    to: unknown;
} | {
    field: FieldPath;
    from: unknown;
    kind: "modified";
    ref: Ref;
    to: unknown;
} | {
    from: BulkEntry;
    kind: "resized";
    ref: Ref;
    to: BulkEntry;
} | {
    from: string;
    kind: "renamed";
    to: string;
} | {
    kind: "added";
    ref: Ref;
    type: EntityTypeName;
} | {
    kind: "removed";
    ref: Ref;
    type: EntityTypeName;
};
```

Refers to [`BulkEntry`](#bulkentry), [`EntityTypeName`](#entitytypename), [`Pt`](#pt), [`Ref`](#ref).

## `SceneDefinition`

_type_ in `scene/types.ts`

A scene document, the same in memory as on disk. Bulk arrays sit at the
top level under their bulk keys; read them through the registry.

```ts
type SceneDefinition = {
    $schema?: string;
    [bulkKey: BulkKey]: unknown;
    /** Assets only game code names, sorted and unique. */
    assets?: AssetId[];
    bounds: Bounds;
    entities?: EntityDef[];
    /** The game whose registry validates this file; omitted means engine primitives only. */
    game?: string;
    /** Declared groups by id. A member of a group stores geometry local to the group's `at`. */
    groups?: Record<string, GroupDef>;
    instances?: InstanceDef[];
    name: string;
    settings?: SceneSettings;
    v: number;
};
```

Refers to [`BulkKey`](#bulkkey), [`EntityDef`](#entitydef).

## `SceneFragment`

_type_ in `scene/fragment.ts`

A piece of a scene on its own: what copy puts on the clipboard as JSON
text, so it also pastes into and out of a chat with an agent. Bulk
entries have no ids, so they travel under their bulk key.

```ts
type SceneFragment = {
    bulk?: Record<BulkKey, BulkEntry[]>;
    entities: EntityDef[];
    /** The game whose registry judges it; omitted, whichever registry it is pasted into. */
    game?: string;
    /** Copied instances; their prefabs travel by id, not in the fragment. */
    instances?: InstanceDef[];
    kind: typeof FRAGMENT_KIND;
    /** The scene format version the fragment was written at. */
    v: number;
};
```

Refers to [`BulkEntry`](#bulkentry), [`BulkKey`](#bulkkey), [`EntityDef`](#entitydef).

## `SceneHash`

_type_ in `scene/types.ts`

16 lowercase hex characters over the canonical text.

```ts
type SceneHash = string;
```

## `SceneIssue`

_type_ in `scene/types.ts`

```ts
type SceneIssue = {
    at?: Pt;
    code: IssueCode;
    /** Facts specific to the code, e.g. `code-skew`'s two schema hashes. */
    detail?: Record<string, unknown>;
    entityIds: string[];
    expected?: string;
    fix?: OpBatch;
    got?: string;
    hint?: string;
    line?: number;
    /** One sentence; names ids, not indices. */
    message: string;
    /**
     * JSON Pointer into the on-disk document, e.g. `/entities/3/path/pts/1`;
     * for an op that failed to apply, into its batch (`/ops/2/ref`).
     */
    path?: string;
    severity: Severity;
};
```

Refers to [`OpBatch`](#opbatch), [`Pt`](#pt).

## `SceneOp`

_type_ in `scene/types.ts`

```ts
type SceneOp = {
    about?: Pt;
    flip?: "x" | "y";
    groups?: string[];
    op: "transform";
    refs?: string[];
    turn?: -1 | 1 | 2 | 3;
} | {
    add?: AssetId[];
    op: "useAssets";
    remove?: AssetId[];
} | {
    anchor?: SpotAnchor;
    at: Pt;
    op: "place";
    ref: Ref;
} | {
    at?: Pt;
    /** Absolute; false is written as absent. */
    flip?: boolean;
    id: string;
    name?: null | string;
    op: "setGroup";
    remove?: boolean;
    /** Absolute; 0 is written as absent. */
    rot?: 0 | 1 | 2 | 3;
} | {
    at?: Pt;
    id: string;
    instance?: string;
    op: "createPrefab";
    refs: Ref[];
} | {
    base: null | string;
    op: "setPrefabBase";
} | {
    by: Pt;
    op: "move";
    refs: Ref[];
} | {
    by?: number;
    op: "setZ";
    refs: Ref[];
    z?: number;
} | {
    cells?: CellEdit[];
    field: string;
    op: "paintCells";
    rects?: CellRect[];
    ref: Ref;
} | {
    entity: EntityInput;
    index?: number;
    op: "add";
} | {
    from: string;
    op: "rename";
    to: string;
} | {
    id: string;
    op: "definePrefab";
    prefab: PrefabBody | null;
} | {
    id: string;
    op: "demote";
} | {
    id: string;
    op: "promote";
    ref: Ref;
} | {
    index: number;
    op: "reorder";
    refs: Ref[];
} | {
    index?: number;
    instance: InstanceInput;
    op: "instantiate";
} | {
    index?: number;
    key: BulkKey;
    op: "addBulk";
    points: Pt[];
} | {
    index?: number;
    key: BulkKey;
    op: "addBulk";
    shapes: ShapeInput[];
} | {
    name: string;
    op: "exposeParam";
    param: PrefabParam | null;
} | {
    name: string;
    op: "setParam";
    ref: string;
    value: unknown;
} | {
    op: "applyToPrefab";
    paths?: OverridePath[];
    ref: Ref;
    to?: string;
} | {
    op: "override";
    ref?: Ref;
    set: Record<OverridePath, unknown>;
} | {
    op: "remove";
    refs: Ref[];
} | {
    op: "revertOverride";
    paths?: OverridePath[];
    ref?: Ref;
} | {
    op: "setScene";
    set: {
        bounds?: Bounds;
        name?: string;
    };
} | {
    op: "setSettings";
    set?: Record<FieldPath, unknown>;
    unset?: FieldPath[];
} | {
    op: "unpack";
    ref: Ref;
} | {
    op: "update";
    ref: Ref;
    set?: Record<FieldPath, unknown>;
    unset?: FieldPath[];
};
```

Refers to [`BulkKey`](#bulkkey), [`Pt`](#pt), [`Ref`](#ref).

## `SceneOrigin`

_type_ in `collab/types.ts`

```ts
type SceneOrigin = DocOrigin;
```

## `ScenePresence`

_type_ in `collab/types.ts`

What each client publishes through awareness. None of it is in the doc.
Selection names entity keys, which stay put while bulk refs shift.

```ts
type ScenePresence = {
    /** World coordinates. */
    cursor?: Pt;
    /** A drag in progress: the keys being dragged and the offset so far. */
    ghost?: {
        by: Pt;
        keys: string[];
    };
    mode: "edit" | "play";
    selection: string[];
    tool?: string;
    user: {
        color: string;
        id: string;
        name: string;
    };
};
```

Refers to [`Pt`](#pt).

## `SelectMode`

_type_ in `editor/selection.ts`

```ts
type SelectMode = "add" | "range" | "replace" | "toggle";
```

## `SessionHistory`

_type_ in `editor/session.ts`

Undo and history kept somewhere other than the session's doc: a session
on a scratch doc whose batches are written through to another (a prefab
edited in isolation) undoes there, so one history covers both.

```ts
type SessionHistory = {
    /** Ends the step a batch this session wrote to its own doc made; the session calls it after each one. */
    commit?(selection: SelectionMeta): void;
    redo(): SelectionMeta | boolean;
    revert(entryId: string): RevertResult;
    state(): Pick<EditorStoreState, "canRedo" | "canUndo" | "history" | "redoLabel" | "undoLabel">;
    /** Calls back whenever `state()` may have changed. */
    subscribe(listener: () => void): () => void;
    /** False when there was nothing to undo; the selection to restore when the step was this session's doc's. */
    undo(): SelectionMeta | boolean;
};
```

Refers to [`EditorStoreState`](#editorstorestate), [`RevertResult`](#revertresult).

## `SettingsRowsOptions`

_type_ in `editor/settings-model.ts`

```ts
type SettingsRowsOptions = {
    /** Px per metre for metric steps; default the registry's, else the engine's. */
    pxPerMetre?: number;
    /** The game's registry: its `meta.widget` widgets and its px per metre. */
    registry?: Registry;
};
```

Refers to [`Registry`](#registry).

## `SettingsSection`

_type_ in `editor/settings-model.ts`

A tab of the project settings panel.

```ts
type SettingsSection = {
    id: "engine" | "general" | "input" | "layers" | "scenes" | (string & {});
    title: string;
};
```

## `ShapeConversion`

_type_ in `editor/inspector-model.ts`

```ts
type ShapeConversion = {
    /** Converting back gives the same shape. */
    lossless: boolean;
    /** What a lossy conversion loses, for the warning. */
    note?: string;
    to: ShapeType;
    tuple: ShapeTuple;
};
```

Refers to [`ShapeTuple`](#shapetuple).

## `ShapeObj`

_type_ in `scene/types.ts`

```ts
type ShapeObj = {
    cx: number;
    cy: number;
    halfLen: number;
    r: number;
    rotDeg: number;
    type: "capsule";
} | {
    cx: number;
    cy: number;
    hh: number;
    hw: number;
    rotDeg: number;
    type: "box";
} | {
    cx: number;
    cy: number;
    r: number;
    type: "circle";
} | {
    pts: Pt[];
    type: "chain";
} | {
    pts: Pt[];
    type: "poly";
};
```

Refers to [`Pt`](#pt).

## `ShapeSlot`

_type_ in `editor/inspector.ts`

One tuple slot of a shape the inspector can edit as a number.

```ts
type ShapeSlot = {
    index: number;
    name: string;
    size: boolean;
    value: number;
};
```

## `ShapeTuple`

_type_ in `scene/types.ts`

```ts
type ShapeTuple = [
    "box",
    cx: number,
    cy: number,
    hw: number,
    hh: number
] | [
    "box",
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    rotDeg: number
] | [
    "capsule",
    cx: number,
    cy: number,
    halfLen: number,
    r: number
] | [
    "capsule",
    cx: number,
    cy: number,
    halfLen: number,
    r: number,
    rotDeg: number
] | [
    "chain",
    ...coords: number[]
] | [
    "circle",
    cx: number,
    cy: number,
    r: number
] | [
    "poly",
    ...coords: number[]
];
```

## `SnapGuide`

_type_ in `editor/snap.ts`

```ts
type SnapGuide = {
    from: Pt;
    to: Pt;
};
```

Refers to [`Pt`](#pt).

## `SnapMoveInput`

_type_ in `editor/snap.ts`

```ts
type SnapMoveInput = {
    /** The moved selection's box before the drag. */
    aabb: Aabb;
    /** Ctrl/Cmd: no snapping, still whole world px. */
    bypass: boolean;
    /** The pointer's raw offset since the drag started. */
    delta: Pt;
    /** Refs that move with the drag and so are never targets. */
    exclude?: readonly Ref[];
    /** Where the drag started, metres. */
    grab: Pt;
    /** Other entities to snap to; without it only the grid snaps. */
    index?: SpatialIndex;
    /** The game's px per metre: the result lands on whole world px. */
    pxPerMetre: number;
    /** Screen px per metre. */
    scale: number;
    settings: SnapSettings;
    /** Where to look for targets; default the moved box plus `SNAP_REACH_PX`. */
    view?: Aabb;
};
```

Refers to [`Aabb`](#aabb), [`Pt`](#pt), [`Ref`](#ref), [`SnapSettings`](#snapsettings), [`SpatialIndex`](#spatialindex).

## `SnapMoveResult`

_type_ in `editor/snap.ts`

```ts
type SnapMoveResult = {
    by: {
        x?: SnapTarget;
        y?: SnapTarget;
    };
    /** Metres, on whole world px. */
    delta: Pt;
    /**
     * One line per snapped axis: along the target from the moved box to the
     * entity it lines up with, or for a grid snap the grid line across the
     * moved box.
     */
    guides: SnapGuide[];
};
```

Refers to [`Pt`](#pt), [`SnapGuide`](#snapguide), [`SnapTarget`](#snaptarget).

## `SnapSettings`

_type_ in `editor/tools.ts`

Grid snapping as the editor's settings hold it; persisted per viewer by the host.

```ts
type SnapSettings = {
    /** Rotation snaps to this many degrees (15); Shift rotates freely. */
    angleDeg: number;
    enabled: boolean;
    /** Snap to other entities' edges, vertices and centres after the grid. */
    geometry: boolean;
    /** Metres between grid lines, one of `SNAP_STEPS`. */
    step: number;
};
```

## `SnapTarget`

_type_ in `editor/snap.ts`

```ts
type SnapTarget = "center" | "edge" | "grid" | "vertex";
```

## `SpatialIndex`

_type_ in `editor/tools.ts`

The uniform grid of AABBs picking and marquee query.

```ts
type SpatialIndex = {
    entries(): IndexEntry[];
    get(ref: Ref): IndexEntry | undefined;
    /** Entries whose AABB intersects `rect`, topmost first. */
    query(rect: Aabb): IndexEntry[];
    readonly size: number;
};
```

Refers to [`Aabb`](#aabb), [`IndexEntry`](#indexentry), [`Ref`](#ref).

## `SpatialIndexOptions`

_type_ in `editor/spatial-index.ts`

```ts
type SpatialIndexOptions = {
    /**
     * Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`); read at
     * each (re)index. Without it a sprite's box is its block's size or 32×32.
     */
    asset?: SpriteAssetLookup;
    /** Metres per grid cell; default 2.56. */
    cell?: number;
    /**
     * The doc key behind a ref (`EditorSession.keyOf`). Without it, or when it
     * answers `undefined`, an entry's key is its ref.
     */
    keyOf?: (ref: Ref) => string | undefined;
};
```

Refers to [`Ref`](#ref).

## `StrokeFit`

_type_ in `editor/builtin/polyline.ts`

What the shape field a stroke fills takes.

```ts
type StrokeFit = {
    /** Chains, open or closed. */
    chain: boolean;
    /** Concave polys (a `polygonField`). */
    concavePoly: boolean;
};
```

## `ToolHost`

_type_ in `editor/tool-host.ts`

```ts
type ToolHost = {
    /** Applies the active tool's overlay offer (**Convert to chain**). */
    acceptOffer(): boolean;
    /** Escape: cancels the gesture, else leaves point editing, else drops the tool, else clears the selection. */
    cancel(): boolean;
    /**
     * A keymap command or a host button: `tool:<id>[:<arg>]` picks a tool;
     * anything else goes to the active tool first, then the host's defaults
     * (nudge, rotate, turn, flip, select-all, group, ungroup, bring-forward,
     * send-backward, hierarchy, delete,
     * duplicate, toggle-snap, frame, undo, redo, pan-hold and Escape's
     * commands). True when it applied.
     */
    command(command: string): boolean;
    /** The selection as clipboard text; empty with nothing selected. */
    copy(): string;
    /** The canvas cursor the active tool asks for. */
    cursor(): string | undefined;
    /** The selection's clipboard text, removing it in one batch; empty with nothing selected. */
    cut(): string;
    destroy(): void;
    /** Copies the selection one grid step down and right, in one batch. */
    duplicate(): boolean;
    /** The spatial index the tools pick from, kept current with the session. */
    index(): SpatialIndex;
    /**
     * A key press or release for the active tool (the pen's Enter and
     * Backspace); call it before resolving the keymap and stop when it returns
     * true. An unclaimed Enter enters point editing; releasing Space ends a
     * held pan.
     */
    key(e: ToolKeyEvent): boolean;
    /** The parts of the keymap's context the host knows. */
    keyContext(): Pick<KeyContext, "gesture" | "hasSelection" | "quarterTurns" | "subObject" | "tool">;
    layers(): ToolLayers;
    /** The active tool's setting (`overlay().option`), without building the selection's outlines. */
    option(): ToolOption | undefined;
    /** What to draw this frame: the selection's outlines (as previewed) and the active tool's overlay. */
    overlay(): ToolOverlay;
    /** Pastes clipboard text centred at `at` (default the last pointer position) in one batch. */
    paste(text: string, at?: Pt): boolean;
    /** The last pointer position in world metres; `null` before any. */
    pointerWorld(): Pt | null;
    /** Rebuilds the index, for when the `asset` lookup's answers changed. */
    reindex(): void;
    /** The box around the selection; `null` when nothing selected has geometry. */
    selectionBounds(): Aabb | null;
    setLayers(patch: {
        hidden?: Iterable<string>;
        locked?: Iterable<string>;
    }): void;
    setSnap(patch: Partial<SnapSettings>): void;
    /** Picks a tool and passes it `arg` as a command; false for an unknown id. */
    setTool(id: string, arg?: string): boolean;
    snap(): SnapSettings;
    subscribe(listener: () => void): () => void;
    /** The active tool's id. */
    tool(): string;
    /** Every tool the host can pick: the engine's, then the game's. */
    tools(): readonly EditorToolDef[];
};
```

Refers to [`Aabb`](#aabb), [`EditorToolDef`](#editortooldef), [`KeyContext`](#keycontext), [`Pt`](#pt), [`SnapSettings`](#snapsettings), [`SpatialIndex`](#spatialindex), [`ToolKeyEvent`](#toolkeyevent), [`ToolLayers`](#toollayers), [`ToolOption`](#tooloption), [`ToolOverlay`](#tooloverlay).

## `ToolHostOptions`

_type_ in `editor/tool-host.ts`

```ts
type ToolHostOptions = {
    /**
     * Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`), read at
     * each re-index; call `reindex` when its answers change.
     */
    asset?: SpriteAssetLookup;
    /** Replacements for built-in tools, by their engine id (a box tool drawing another type). */
    engineTools?: readonly EditorToolDef[];
    /** Frames a world rect (the `frame` command). */
    frame?: (rect: Aabb) => void;
    /** The game's tools (`GameDefinition.editor.tools()`, loaded); an engine id or a repeated id throws. */
    gameTools?: readonly EditorToolDef[];
    layers?: {
        hidden?: Iterable<string>;
        locked?: Iterable<string>;
    };
    /** Clock for multi-click detection; default `performance.now`. */
    now?: () => number;
    /** After anything the overlay, cursor or key context depend on changed. */
    onChange?: () => void;
    /** Pans the camera by a screen-px drag (the pan tool, Space, the middle button). */
    pan?: (screenDelta: Pt) => void;
    /** The shell's router; the host registers one pointer consumer at `TOOL_PRIORITY.editor`. */
    router: ToolRouter;
    /**
     * A runtime to show previews in as well as the overlay. The editor leaves
     * it out, so the edit world only ever holds committed state.
     */
    runtime?: PreviewRuntime | null;
    /** Screen px per metre now. */
    scale: () => number;
    session: EditorSession;
    snap?: SnapSettings;
    /** Router screen px to world metres: the shell's `screenToWorld`. */
    toWorld: (screen: Vec2) => Pt;
    /** The tool to start with; default `select`. */
    tool?: string;
    /** Zooms about a screen point, for wheel turns no tool takes. */
    zoomAt?: (screen: Pt, factor: number) => void;
};
```

Refers to [`Aabb`](#aabb), [`EditorSession`](#editorsession), [`EditorToolDef`](#editortooldef), [`PreviewRuntime`](#previewruntime), [`Pt`](#pt), [`SnapSettings`](#snapsettings).

## `ToolKeyEvent`

_type_ in `editor/tools.ts`

```ts
type ToolKeyEvent = ToolModifiers & {
    key: string;
    repeat: boolean;
    type: "down" | "up";
};
```

Refers to [`ToolModifiers`](#toolmodifiers).

## `ToolLayers`

_type_ in `editor/tool-host.ts`

```ts
type ToolLayers = {
    hidden: ReadonlySet<string>;
    locked: ReadonlySet<string>;
};
```

## `ToolModifiers`

_type_ in `editor/tools.ts`

```ts
type ToolModifiers = {
    alt: boolean;
    mod: boolean;
    shift: boolean;
};
```

## `ToolOption`

_type_ in `editor/tools.ts`

One choice the active tool offers. Picking a choice sends the tool the
command `<command><value>` (`type:nav`), which `tool:<id>:<command><value>`
also reaches from a key binding. Kept the same object while nothing in it
changes, so a host can compare it by identity.

```ts
type ToolOption = {
    choices: readonly {
        description?: string;
        label: string;
        value: string;
    }[];
    command: string;
    label: string;
    value: string;
};
```

## `ToolOverlay`

_type_ in `editor/tools.ts`

Everything a tool wants drawn over the scene this frame, in world
coordinates. The host draws it (the site in SVG over the canvas) and
never interprets it.

```ts
type ToolOverlay = {
    /** One box around a selection of several items, or of an instance's children. */
    bounds?: Aabb;
    /** Shapes about to be placed. */
    ghosts?: {
        reason?: string;
        shape: ShapeObj;
        style?: Style;
        valid: boolean;
    }[];
    /** Snap alignment lines. */
    guides?: {
        from: Pt;
        to: Pt;
    }[];
    handles?: GizmoHandle[];
    /**
     * A drag-select rectangle; `touch` selects what it touches, not only what
     * it contains. `hits` is what releasing it now would select; the host
     * outlines them during the drag.
     */
    marquee?: {
        hits?: Ref[];
        rect: Aabb;
        touch: boolean;
    };
    /**
     * A fix the host may offer after a commit (a poly left concave offers
     * **Convert to chain**); the tool's `accept-offer` command applies it.
     */
    offer?: {
        batch: OpBatch;
        label: string;
    };
    /** A setting of the active tool the host shows beside the tools (the type a draw tool adds). */
    option?: ToolOption;
    /**
     * `ref` names the entity an outline belongs to, so panels can match it.
     * `preview` marks where the drag in progress puts it, drawn filled; a
     * `ghost` outline is where it started.
     */
    outlines?: {
        preview?: boolean;
        ref?: Ref;
        shape: ShapeObj;
        tone: OverlayTone;
    }[];
    points?: {
        at: Pt;
        preview?: boolean;
        ref?: Ref;
        tone: OverlayTone;
    }[];
    /** Paths and pen strokes; `numbered` labels each point from 0. */
    polylines?: {
        closed: boolean;
        dashed?: boolean;
        numbered?: boolean;
        pts: Pt[];
        tone: OverlayTone;
    }[];
    /** The drag readout: `Δ 0.64, 0 m`, `W 1.6 H 0.16 m`, `37°`. */
    readout?: {
        at: Pt;
        text: string;
    };
};
```

Refers to [`Aabb`](#aabb), [`GizmoHandle`](#gizmohandle), [`OpBatch`](#opbatch), [`OverlayTone`](#overlaytone), [`Pt`](#pt), [`Ref`](#ref), [`ShapeObj`](#shapeobj), [`ToolOption`](#tooloption).

## `ToolPointerEvent`

_type_ in `editor/tools.ts`

```ts
type ToolPointerEvent = ToolModifiers & {
    button: number;
    /** Presses in quick succession at about this spot: 2 on a double-click's second press. */
    clicks: number;
    deltaY: number;
    /** CSS px from the canvas's top-left, for tools that work in screen space (panning). */
    screen?: Pt;
    type: "down" | "move" | "up" | "wheel";
    /** World metres under the pointer, unsnapped and unrounded. */
    world: Pt;
};
```

Refers to [`Pt`](#pt), [`ToolModifiers`](#toolmodifiers).

## `VELOCITY_PX`

_const_ in `editor/gizmos/behavior-target.ts`

Screen px of arrow per m/s of a spawner's `velocity`.

```ts
declare const VELOCITY_PX = 16;
```

## `WHEEL_ZOOM`

_const_ in `editor/tool-host.ts`

How much one wheel notch (`deltaY` 100) zooms when no tool takes the wheel.

```ts
declare const WHEEL_ZOOM = 1.15;
```

## `applyLevels`

_function_ in `editor/prefab-commands.ts`

The prefabs Apply to prefab can write a ref's overrides to, outermost
first: the levels every one of its keys reaches (`applyToPrefab`'s `to`).
Empty when the ref has no overrides.

```ts
declare function applyLevels(def: SceneDefinition, ref: Ref, prefabs: PrefabLibrary): string[];
```

Refers to [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `applyToPrefabBatch`

_function_ in `editor/prefab-commands.ts`

Folds the overrides a ref covers into a prefab: the instance's own, or
with `to` a deeper one from `applyLevels` (which needs `prefabs`). Null
when there's nothing to apply or `to` isn't a level the keys reach.

```ts
declare function applyToPrefabBatch(def: SceneDefinition, ref: Ref, opts?: {
    prefabs?: PrefabLibrary;
    to?: string;
}): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `asProjectBatch`

_function_ in `editor/prefab-commands.ts`

A scene batch as one `editScene` of a project batch, for `applyProjectBatch` (agents, the CLI).

```ts
declare function asProjectBatch(scene: AssetId, batch: OpBatch): ProjectOpBatch;
```

Refers to [`OpBatch`](#opbatch).

## `attachBatch`

_function_ in `editor/attach.ts`

One `update` pointing `ref`'s `attachField` at `follower`, or clearing it
when `follower` is null. A follower may be an instance's child by its
resolved ref (`gate-2/lift`), found through `prefabs`. Null when `ref`
isn't one of the document's entities, its type has no `attachField`, the
follower isn't a type that field may name, or nothing would change.

```ts
declare function attachBatch(def: SceneDefinition, ref: Ref, follower: Ref | null, registry: Registry, prefabs?: PrefabLibrary): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `attachFieldOf`

_function_ in `editor/attach.ts`

A placeable type's `attachField` and the types it may ride, or null when it has none.

```ts
declare function attachFieldOf(registry: Registry, type: EntityTypeName): null | {
    field: string;
    targets: readonly EntityTypeName[];
};
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `behaviorGizmo`

_function_ in `editor/gizmos/behavior-target.ts`

The behavior gizmo of the entity `ref` in `def` (the resolved view):
undefined when it carries none of `collider`, `joint`, `force-area` or
`spawner`, or is a bulk row.

```ts
declare function behaviorGizmo(def: SceneDefinition, registry: Registry, ref: Ref, geometry?: EditGeometry): BehaviorGizmo | undefined;
```

Refers to [`BehaviorGizmo`](#behaviorgizmo), [`EditGeometry`](#editgeometry), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `behaviorHandles`

_function_ in `editor/gizmos/handles.ts`

A behavior gizmo's handles, ids prefixed by the behavior: the collider's
shape handles (no move: the entity's own moves it), the joint's anchors,
the force area's arrow tip or strength ring, the spawner's spread ring
and velocity tip. A force is drawn `FORCE_PX` screen px per m/s², a
velocity `VELOCITY_PX` per m/s; the spread is its radius in metres.

```ts
declare function behaviorHandles(b: BehaviorGizmo, scale: number): GizmoHandle[];
```

Refers to [`BehaviorGizmo`](#behaviorgizmo), [`GizmoHandle`](#gizmohandle).

## `behaviorMarks`

_function_ in `editor/gizmos/behavior-marks.ts`

What `b` draws at screen scale `scale` (px per metre): the collider's
outline, the joint's line to the entity it links and between its anchors,
the force area's arrow or strength ring, the spawner's spread ring
and velocity arrow. `handles` are the host's handles this frame: one of
`b`'s that isn't where the document puts it is being dragged, and its
mark follows it. `shift` is how far a previewed move has taken the entity.

```ts
declare function behaviorMarks(committed: BehaviorGizmo, scale: number, handles?: readonly GizmoHandle[], opts?: {
    shift?: Pt;
}): BehaviorMarks;
```

Refers to [`BehaviorGizmo`](#behaviorgizmo), [`BehaviorMarks`](#behaviormarks), [`GizmoHandle`](#gizmohandle), [`Pt`](#pt).

## `boundsCheck`

_function_ in `editor/placement.ts`

The engine's check on anything about to land in a scene (a placement
ghost, a drop, a drawn shape): it has to fit inside the scene's bounds.

```ts
declare function boundsCheck(box: Aabb, def: SceneDefinition): PlacementCheck;
```

Refers to [`Aabb`](#aabb), [`PlacementCheck`](#placementcheck), [`SceneDefinition`](#scenedefinition).

## `boxTool`

_const_ in `editor/builtin/draw.ts`

```ts
declare const boxTool: EditorToolDef;
```

Refers to [`EditorToolDef`](#editortooldef).

## `buildInspectorModel`

_function_ in `editor/inspector-model.ts`

What the inspector shows for a selection: each registered type's schema
walked into field descriptors, titled by `meta.title`, explained by
`.describe()`, drawn by the widget its Zod kind (or a game's
`meta.widget`) calls for, and sectioned by `meta.group` or, without one,
by kind. Each behavior every target carries gets its own section,
`behaviors:<name>`, with its fields in `inspector.order` (each with its
`meta.group`) and a Remove batch; `addBehaviors` lists the rest the types
allow, each adding what it requires too. With several
targets only the fields they share are shown, and a field whose values
differ is `mixed`. Pure: the site renders it.

```ts
declare function buildInspectorModel(registry: Registry, targets: readonly RefTarget[], opts?: {
    /** The scene the targets are in (the resolved view): Add behavior seeds a reference from it. */
    def?: SceneDefinition;
    /**
     * Where an `anim` block's source is read (`clipLookupOf`): Add behavior
     * picks its source and clip from the project's animations' clips (over
     * an atlas's tags) and points the sprite at the source's atlas
     * (`animSpriteOf`). Without it, Add can't pick a clip.
     */
    sources?: ClipSourceLookup;
}): InspectorModel;
```

Refers to [`InspectorModel`](#inspectormodel), [`RefTarget`](#reftarget), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `buildOutline`

_function_ in `editor/outline.ts`

The outliner's rows, flattened depth-first: one row per registered type the
scene uses, in registration order, holding its bulk keys (each with a child
row per entry) and then its entities in file order. Types the scene can't
place (unknown or spawn-only) come last, under their own names. Instances follow under one
`instances` row, each with a row per child of its prefab and per
instance nested in it, a level deeper each time.

```ts
declare function buildOutline(def: SceneDefinition, registry: Registry, prefabs?: PrefabLibrary): OutlineRow[];
```

Refers to [`OutlineRow`](#outlinerow), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `builtinTools`

_function_ in `editor/tool-host.ts`

The engine's tools, one fresh list per call: select, pan, box, circle, pen, waypoints, rotate.

```ts
declare function builtinTools(): EditorToolDef[];
```

Refers to [`EditorToolDef`](#editortooldef).

## `bulkGeometry`

_function_ in `editor/spatial-index.ts`

A bulk entry's geometry: its shape or point, under the bulk key's field.

```ts
declare function bulkGeometry(registry: Registry, key: BulkKey, value: unknown): EditGeometry | undefined;
```

Refers to [`BulkKey`](#bulkkey), [`EditGeometry`](#editgeometry), [`Registry`](#registry).

## `capsuleLength`

_function_ in `editor/gizmos/drag.ts`

A capsule's half-length from its `length` handle: the caps stay `r`, the centre stays put.

```ts
declare function capsuleLength(c: Capsule, to: Pt, pxPerMetre: number): Capsule;
```

Refers to [`Pt`](#pt).

## `childOverrides`

_function_ in `editor/prefab-commands.ts`

For an instance child's ref: its instance, its id in the prefab, and each
top-level field it overrides with the override keys behind it. Null for
anything else.

```ts
declare function childOverrides(def: SceneDefinition, ref: Ref): null | {
    child: string;
    fields: Map<string, string[]>;
    instance: string;
};
```

Refers to [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `circleTool`

_const_ in `editor/builtin/draw.ts`

```ts
declare const circleTool: EditorToolDef;
```

Refers to [`EditorToolDef`](#editortooldef).

## `convertToChainFix`

_function_ in `editor/gizmos/batch.ts`

The **Convert to chain** offer after a commit left `ref`'s poly concave:
the fix `validateScene` attaches to its `poly-invalid` issue (a convex
hull where the field can't hold a chain); `undefined` when there is none.

```ts
declare function convertToChainFix(def: SceneDefinition, registry: Registry, ref: Ref): OpBatch | undefined;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `copySelection`

_function_ in `editor/clipboard.ts`

The selection as clipboard text: a pretty-printed `SceneFragment`, for
`text/plain`. `def` is the document; with `prefabs`, refs to instance
children (`gate-2/door`) copy them as plain entities.

```ts
declare function copySelection(def: SceneDefinition, refs: readonly Ref[], registry: Registry, prefabs?: PrefabLibrary): string;
```

Refers to [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `createDrawTool`

_function_ in `editor/builtin/draw.ts`

A tool that draws one shape per drag, snapped (Ctrl/Cmd bypasses), and
commits it as one `add` on release; Escape mid-drag drops it. The shape
becomes the picked type (`type:<name>`), offered in the overlay's `option`.

```ts
declare function createDrawTool(opts: DrawToolOptions): EditorToolDef;
```

Refers to [`DrawToolOptions`](#drawtooloptions), [`EditorToolDef`](#editortooldef).

## `createEditorSession`

_function_ in `editor/session.ts`

An editor on a shared `Y.Doc`. Every batch goes through `applyOpsToDoc`
with this client's origin; undo and redo step only this client's
batches; history is the doc's `log`, so it names every actor, remote
ones included. Selection is kept as doc keys, so it survives other
people's edits shifting bulk refs.

```ts
declare function createEditorSession({ doc, origin, name, registry, awareness, user, key, issuesDebounceMs, history, prefabs, parentBounds, project }: EditorSessionOptions): EditorSession;
```

Refers to [`EditorSession`](#editorsession), [`EditorSessionOptions`](#editorsessionoptions).

## `createEditorStore`

_function_ in `editor/store.ts`

```ts
declare function createEditorStore(init?: Partial<EditorStoreState>): Store<EditorStoreState>;
```

Refers to [`EditorStoreState`](#editorstorestate).

## `createGesturePreview`

_function_ in `editor/gesture.ts`

Live feedback for a drag: a batch applied to the document with the pure
`applyOps` and pushed to the runtime through `update` (its fast path, not
a respawn), never written to the document. Each preview replaces the
last; ids the new one no longer changes go back to the document's state.

```ts
declare function createGesturePreview({ registry, getDoc, runtime }: GesturePreviewOptions): GesturePreview;
```

Refers to [`GesturePreview`](#gesturepreview), [`GesturePreviewOptions`](#gesturepreviewoptions).

## `createHistory`

_function_ in `editor/history.ts`

```ts
declare function createHistory({ cap, coalesceMs, now }?: HistoryOptions): History;
```

Refers to [`History`](#history), [`HistoryOptions`](#historyoptions).

## `createKeymap`

_function_ in `editor/keymap.ts`

The editor's scoped keymap with a game's `editorKeys` added. Engine
bindings always win: a game binding on a chord the engine binds in the
same scope, or globally, is reported in `shadowed` and never resolves.

```ts
declare function createKeymap(gameKeys?: readonly GameKeyBinding[]): Keymap;
```

Refers to [`GameKeyBinding`](#gamekeybinding), [`Keymap`](#keymap).

## `createPenTool`

_function_ in `editor/builtin/polyline.ts`

The pen (`P`): a stroke of clicks becomes one chain or poly of the picked
type (`type:<name>`, offered in the overlay's `option`; default `solid`).
For a type that takes no chain, an open stroke of three points or more
closes; finishing a shorter one keeps it open and says it needs three.

```ts
declare function createPenTool(opts?: {
    type?: string;
}): {
    create(ctx: EditorToolContext): {
        cancel?(): boolean;
        command: (command: (string & {}) | EditorCommand) => boolean;
        cursor?(): string | undefined;
        destroy?(): void;
        gesture?(): boolean;
        key?(e: ToolKeyEvent): boolean;
        overlay(): ToolOverlay;
        pointer?(e: ToolPointerEvent): boolean;
        subObject?(): boolean;
    };
    description: string;
    id: string;
    label: string;
};
```

Refers to [`EditorCommand`](#editorcommand), [`EditorToolContext`](#editortoolcontext), [`ToolKeyEvent`](#toolkeyevent), [`ToolOverlay`](#tooloverlay), [`ToolPointerEvent`](#toolpointerevent).

## `createPrefabBatch`

_function_ in `editor/prefab-commands.ts`

Create prefab from selection: the selected entities, bulk entries and
instances (which nest in it) become a new prefab, named after the first
one, with one instance where they stood. `taken` adds ids the new prefab
can't have besides the library's (every asset id in the project). Null
when the selection holds instance children, which live in their prefab.

```ts
declare function createPrefabBatch(def: SceneDefinition, refs: readonly Ref[], prefabs: PrefabLibrary, taken?: Iterable<string>): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `createSpatialIndex`

_function_ in `editor/spatial-index.ts`

The uniform grid of AABBs picking, marquee and snapping query. Entries
cover every bulk entry and every entity with a shape or point, `off`
entities and notes included; an entity on a path is indexed at the
path's first point. An entity carrying a sprite is also hit by the box
the sprite draws; a point entity's sprite box is its geometry.

```ts
declare function createSpatialIndex(opts?: SpatialIndexOptions): EditableSpatialIndex;
```

Refers to [`EditableSpatialIndex`](#editablespatialindex), [`SpatialIndexOptions`](#spatialindexoptions).

## `createToolHost`

_function_ in `editor/tool-host.ts`

Runs the editor's tools on a session: takes the canvas's pointer events
from the router, keeps a spatial index current, previews gestures in the
overlay (and in `runtime` when given one) and commits each as one batch,
and carries the commands the keymap resolves. Framework-free; the site draws `overlay()`
and calls `key` and `command` from its keymap consumer.

```ts
declare function createToolHost(opts: ToolHostOptions): ToolHost;
```

Refers to [`ToolHost`](#toolhost), [`ToolHostOptions`](#toolhostoptions).

## `createVariantBatch`

_function_ in `editor/prefab-commands.ts`

Create variant: a new prefab whose base is `base` and which adds nothing
yet, named `<base>-variant` (numbered when taken). `taken` adds ids it
can't have besides the library's (every asset id in the project);
`folder` is where `createAsset` puts it, default the prefab kind's
folder. Null when the library holds no `base`.

```ts
declare function createVariantBatch(base: string, prefabs: PrefabLibrary, opts?: {
    folder?: string;
    taken?: Iterable<string>;
}): CreateVariant | null;
```

Refers to [`CreateVariant`](#createvariant).

## `cutSelection`

_function_ in `editor/clipboard.ts`

The clipboard text for the selection and the batch that removes it,
instances included. An instance's child (`gate-2/door`) can't be removed
from its prefab, so the batch turns it off on that instance with an
`<child>.off` override; one whose instance is cut as well is left to it.

```ts
declare function cutSelection(def: SceneDefinition, refs: readonly Ref[], registry: Registry, prefabs?: PrefabLibrary): {
    batch: OpBatch;
    text: string;
};
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `cycleHit`

_function_ in `editor/picking.ts`

What Alt-click selects: the hit after `current` among `hits` (topmost
first, wrapping), or the topmost when `current` isn't under the pointer.

```ts
declare function cycleHit(hits: readonly IndexEntry[], current?: Ref): Ref | undefined;
```

Refers to [`IndexEntry`](#indexentry), [`Ref`](#ref).

## `defaultLayer`

_function_ in `scene/layers.ts`

The layer an entity without `layer` sits on: types that never load
(notes) on `editor`, bulk entries on `terrain`, other entities on
`gameplay`. Given a game's `layers` that lack one of those names, an
editor-only type falls back to the last layer and everything else to the
first; without `layers` the names are `DEFAULT_LAYERS`'.

```ts
declare function defaultLayer(type: RegisteredType | undefined, bulk: boolean, layers?: readonly SceneLayerDef[]): string;
```

## `defineEditorTool`

_function_ in `editor/tools.ts`

Types a tool definition; a game lists the result in `GameDefinition.editor.tools`.

```ts
declare function defineEditorTool<T extends EditorToolDef>(def: T): T;
```

Refers to [`EditorToolDef`](#editortooldef).

## `deleteBatch`

_function_ in `editor/commands.ts`

One batch removing `refs`; `null` for an empty selection.

```ts
declare function deleteBatch(refs: readonly Ref[]): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref).

## `deleteVertices`

_function_ in `editor/gizmos/vertices.ts`

`s` without the points at `indices`; `null` when that leaves fewer than `MIN_POINTS`.

```ts
declare function deleteVertices(s: PointShape, indices: readonly number[]): PointShape | null;
```

Refers to [`PointShape`](#pointshape).

## `dirSigns`

_function_ in `editor/gizmos/handles.ts`

A direction's unit signs in the box's frame.

```ts
declare function dirSigns(dir: ResizeDir): Pt;
```

Refers to [`Pt`](#pt), [`ResizeDir`](#resizedir).

## `docRefs`

_function_ in `editor/refs.ts`

Every reference the document holds, in file order: bulk entries, then entities.

```ts
declare function docRefs(def: SceneDefinition): Ref[];
```

Refers to [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `dragAngle`

_function_ in `editor/gizmos/drag.ts`

The pointer's turn about `pivot` from `from` to `to`, degrees clockwise on screen, in (-180, 180].

```ts
declare function dragAngle(pivot: Pt, from: Pt, to: Pt): number;
```

Refers to [`Pt`](#pt).

## `dragBehaviorHandle`

_function_ in `editor/gizmos/drag.ts`

One drag of a behavior gizmo's handle (`behaviorHandles` names them): the
collider's shape handles write `behaviors.collider.shape` in the pose's
frame; the joint's anchors, the force area's `force` or `strength`, and
the spawner's `spread` and `velocity` each write their field. `null` for a
handle `t` doesn't have.

```ts
declare function dragBehaviorHandle(t: GizmoTarget, handleId: string, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `dragHandle`

_function_ in `editor/gizmos/drag.ts`

One single-target gizmo drag, from the handle `handleId` (as
`targetHandles` names it) at pointer-down `from` to the pointer now at
`to`, both raw world metres. `insert:<i>` edits the path when `t` has one,
else the outline. `null` for a handle `t` doesn't have.

```ts
declare function dragHandle(t: GizmoTarget, handleId: string, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `dragInsertVertex`

_function_ in `editor/gizmos/vertices.ts`

Dragging the `+` of segment `segment`: a new vertex starting at the segment's midpoint.

```ts
declare function dragInsertVertex(t: GizmoTarget, segment: number, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `dragInsertWaypoint`

_function_ in `editor/gizmos/waypoints.ts`

Dragging the `+` of segment `segment` (waypoint `segment` to the next; a
loop's last segment closes back to 0): a new waypoint from its midpoint.

```ts
declare function dragInsertWaypoint(t: GizmoTarget, segment: number, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `dragSelection`

_function_ in `editor/gizmos/multi.ts`

A multi-selection's gizmo drag: `move` snaps the selection box and moves
every target in one `move`; `rotate` turns them all about the box's
centre, the turn snapped to the step (Shift: free). No resize: there's
no scaling. `null` for any other handle.

```ts
declare function dragSelection(targets: readonly GizmoTarget[], handleId: string, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `dragVertex`

_function_ in `editor/gizmos/vertices.ts`

Dragging vertex `index` of `t`'s poly or chain from `from` to `to`, snapped.

```ts
declare function dragVertex(t: GizmoTarget, index: number, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `dragWaypoint`

_function_ in `editor/gizmos/waypoints.ts`

Dragging waypoint `index` of `t`'s path, snapped.

```ts
declare function dragWaypoint(t: GizmoTarget, index: number, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `drawBatch`

_function_ in `editor/builtin/draw.ts`

The one `add` that puts a drawn shape in the document: an entry of the
type's own shape bulk key when the registry has one, else an entity of
`type` with a fresh id and the shape in its first shape field. `select`
names what it adds. `null` when `type` has no shape field.

```ts
declare function drawBatch(def: SceneDefinition, registry: Registry, type: string, shape: ShapeObj, label?: string): null | {
    batch: OpBatch;
    select: Ref;
};
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`ShapeObj`](#shapeobj).

## `drawTypeOptions`

_function_ in `editor/builtin/draw.ts`

The types a draw tool can add, in registry order: the placeable ones whose
shape field takes what the tool draws (a box, a circle, or a pen's poly or chain).

```ts
declare function drawTypeOptions(registry: Registry, kind: DrawToolKind): DrawTypeOption[];
```

Refers to [`DrawToolKind`](#drawtoolkind), [`DrawTypeOption`](#drawtypeoption), [`Registry`](#registry).

## `drawnShape`

_function_ in `editor/builtin/draw.ts`

The drawn shape from a press at `a` to the pointer at `b`, both snapped: a
box between the corners (Shift: a square, Alt: from the centre), or a
circle centred on `a` through `b`, on whole world px at `pxPerMetre`.
`null` while it is smaller than one world px.

```ts
declare function drawnShape(kind: "box" | "circle", a: Pt, b: Pt, mods: {
    alt: boolean;
    shift: boolean;
}, pxPerMetre: number): ShapeObj | null;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `dropBatch`

_function_ in `editor/asset-drop.ts`

One batch that places a dropped asset: its fragment's box centred on
`at` and snapped as a paste is, ids that clash renamed. A drop that
isn't placeable gives `ok: false` with an `asset-kind` (or, for an atlas
without a frame, `asset-frame-unknown`) issue.

```ts
declare function dropBatch(drop: AssetDrop, at: Pt, opts: {
    def: SceneDefinition;
    /** The project's prefabs; a dropped prefab needs its own here. */
    prefabs?: PrefabLibrary;
    registry: Registry;
    snap?: SnapSettings;
}): PasteResult;
```

Refers to [`AssetDrop`](#assetdrop), [`PasteResult`](#pasteresult), [`Pt`](#pt), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SnapSettings`](#snapsettings).

## `dropFragment`

_function_ in `editor/asset-drop.ts`

The fragment a dropped asset becomes, or null when the kind isn't
placeable: a texture a `decor` drawing it, an atlas frame a `decor`
drawing that frame, a prefab an instance of it. The game's
`editor.assetDrop` is asked first; its null falls back to these.

```ts
declare function dropFragment(drop: AssetDrop, registry: Registry): SceneFragment | null;
```

Refers to [`AssetDrop`](#assetdrop), [`Registry`](#registry), [`SceneFragment`](#scenefragment).

## `dropPreview`

_function_ in `editor/asset-drop.ts`

What `dropBatch` would place at `at`, drawn before the drop: what it
selects, outlined as the selection would be (`outlinesOfRef`), its
outlines as ghosts and the points of point entities without a sprite as
ghost points, snapped as the drop is. A drop that
would be refused, or that lands outside the scene's bounds, gives
invalid ghosts with the reason. `asset` sizes sprite boxes; without it
the dropped asset's own info does.

```ts
declare function dropPreview(drop: AssetDrop, at: Pt, opts: DropOptions & {
    asset?: SpriteAssetLookup;
}): DropPreview;
```

Refers to [`AssetDrop`](#assetdrop), [`DropOptions`](#dropoptions), [`DropPreview`](#droppreview), [`Pt`](#pt).

## `duplicateSelection`

_function_ in `editor/clipboard.ts`

The selection copied and pasted one grid `step` (metres) down and to the right
(Mod+D), instances included. `from` is the scene the selection is read
from when it differs from `def`.

```ts
declare function duplicateSelection(def: SceneDefinition, refs: readonly Ref[], registry: Registry, step: number, opts?: {
    from?: SceneDefinition;
    prefabs?: PrefabLibrary;
}): PasteResult;
```

Refers to [`PasteResult`](#pasteresult), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `entityGeometry`

_function_ in `editor/spatial-index.ts`

An on-disk entity's geometry, placed the way the renderers place it
(`drawnEntities`): the first shape, point and path field it sets, with a
shape on a path drawn at the path's first point. Fields that don't parse
are left out, so a half-typed shape never throws.

```ts
declare function entityGeometry(type: RegisteredType, e: EntityDef): EditGeometry;
```

Refers to [`EditGeometry`](#editgeometry), [`EntityDef`](#entitydef).

## `expandRefs`

_function_ in `editor/gesture.ts`

The expansion of just `refs` in `def`: entities by id, and each bulk entry
expanded alone and given back its own index. What doesn't expand (an
`off` entity, a half-typed field) is missing from the result.

```ts
declare function expandRefs(def: SceneDefinition, registry: Registry, refs: Iterable<Ref>): Map<string, RuntimeEntity>;
```

Refers to [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `fieldOp`

_function_ in `editor/inspector.ts`

The update that sets one field, by its inspector path.

```ts
declare function fieldOp(ref: Ref, path: string, value: unknown): SceneOp;
```

Refers to [`Ref`](#ref), [`SceneOp`](#sceneop).

## `flipBatch`

_function_ in `editor/commands.ts`

One batch mirroring the selected instances and whole groups across the
world axis: `x` flips left and right, `y` up and down, each about its own
`at`. `null` when the selection holds neither.

```ts
declare function flipBatch(def: SceneDefinition, refs: readonly Ref[], axis: "x" | "y"): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `formatMetres`

_function_ in `editor/gizmos/readout.ts`

A length in metres as the editor prints it: to the decimals that show one
world px at `pxPerMetre`, trailing zeros dropped (`3.25`, `4`, `0.104167`).

```ts
declare function formatMetres(m: number, pxPerMetre: number): string;
```

## `fragmentBounds`

_function_ in `scene/fragment.ts`

The world box around everything in the fragment; `null` when nothing in
it has a position. Its instances count with `prefabs`: the box around
each one's resolved children (a variant's base and nested instances'
children included), turned and flipped with it; one whose prefab isn't
there is skipped.

```ts
declare function fragmentBounds(fragment: SceneFragment, registry: Registry, prefabs?: PrefabLibrary): Aabb | null;
```

Refers to [`Aabb`](#aabb), [`Registry`](#registry), [`SceneFragment`](#scenefragment).

## `fragmentOf`

_function_ in `scene/fragment.ts`

The entities, instances and bulk entries `refs` name, in document order,
as the resolved view holds them (world coordinates); refs that don't
resolve are skipped. An instance travels as itself, its prefab by id; a
child of an instance (`gate-2/door`, resolved through `prefabs`) travels
as a plain entity, unless its instance is copied too.

```ts
declare function fragmentOf(def: SceneDefinition, refs: readonly Ref[], registry: Registry, prefabs?: PrefabLibrary): SceneFragment;
```

Refers to [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition), [`SceneFragment`](#scenefragment).

## `geometryOfRef`

_function_ in `editor/spatial-index.ts`

The world geometry of `ref` in `def`; `undefined` when it has none or isn't there.

```ts
declare function geometryOfRef(def: SceneDefinition, registry: Registry, ref: Ref): (EditGeometry & {
    bulk: boolean;
    type: string;
}) | undefined;
```

Refers to [`EditGeometry`](#editgeometry), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `gizmoTarget`

_function_ in `editor/gizmos/target.ts`

`ref`'s editable geometry in `def`; `undefined` when it isn't there or has no shape or point.

```ts
declare function gizmoTarget(def: SceneDefinition, registry: Registry, ref: Ref): GizmoTarget | undefined;
```

Refers to [`GizmoTarget`](#gizmotarget), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `groupBatch`

_function_ in `editor/commands.ts`

One batch putting the selected entities in a group (their `group` field),
a new one unless `name` is given. Bulk entries have no fields, so they are
left out; `null` when no entity is selected or all are already in it.

```ts
declare function groupBatch(def: SceneDefinition, refs: readonly Ref[], name?: string): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `hierarchyDown`

_function_ in `editor/commands.ts`

`]`: from a selection of several, its first ref in outline order; `null` for one or none.

```ts
declare function hierarchyDown(def: SceneDefinition, registry: Registry, sel: readonly Ref[]): Ref[] | null;
```

Refers to [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `hierarchyUp`

_function_ in `editor/commands.ts`

`[`: the selection's parent. Inside a group not wholly selected, the whole
group; otherwise everything under the first selected ref's outline row
(its bulk key, or its type), climbing past rows that hold exactly the
selection. `null` at the top.

```ts
declare function hierarchyUp(def: SceneDefinition, registry: Registry, sel: readonly Ref[]): Ref[] | null;
```

Refers to [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `hitHandle`

_function_ in `editor/gizmos/handles.ts`

The handle under `p`: the topmost one whose drawn square holds it, else
the nearest within `tolPx` screen px (the topmost on a tie). A handle
partly covered by a neighbour, such as a thin box's corners under a joint
anchor, can still be grabbed where it shows.

```ts
declare function hitHandle(handles: readonly GizmoHandle[], p: Pt, scale: number, tolPx?: number): GizmoHandle | undefined;
```

Refers to [`GizmoHandle`](#gizmohandle), [`Pt`](#pt).

## `insertVertex`

_function_ in `editor/gizmos/vertices.ts`

`s` with a new point `at` on segment `segment`, i.e. at index `segment + 1`.

```ts
declare function insertVertex(s: PointShape, segment: number, at: Pt): PointShape;
```

Refers to [`PointShape`](#pointshape), [`Pt`](#pt).

## `inspectorFields`

_function_ in `editor/inspector.ts`

The fields the inspector shows for a selection, read from its registered
type's schema: titles from `meta.title`, help from `.describe()`, order
from the type's `inspector.order`. A bulk entry shows only its bulk field.
Empty when the type isn't registered.

```ts
declare function inspectorFields(registry: Registry, target: RefTarget): InspectorField[];
```

Refers to [`InspectorField`](#inspectorfield), [`RefTarget`](#reftarget), [`Registry`](#registry).

## `instanceOfRef`

_function_ in `editor/prefab-commands.ts`

The instance an instance's ref or one of its children's refs names.

```ts
declare function instanceOfRef(def: SceneDefinition, ref: Ref): InstanceDef | undefined;
```

Refers to [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `instanceParamsModel`

_function_ in `editor/inspector-model.ts`

The exposed parameters of the instance `ref` names (a scene instance, or
one nested in it, `room-1/door-1`): its prefab's params (`resolvePrefab`,
a variant's base's included), each typed by its first target's schema,
with the value the instance sets. Null when `ref` names no instance or
its prefab doesn't resolve.

```ts
declare function instanceParamsModel(def: SceneDefinition, ref: Ref, registry: Registry, prefabs: PrefabLibrary): InstanceParamsModel | null;
```

Refers to [`InstanceParamsModel`](#instanceparamsmodel), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `instanceTransformModel`

_function_ in `editor/inspector-model.ts`

The placement of the instance `ref` names (a scene instance, or one nested in it); null for anything else.

```ts
declare function instanceTransformModel(def: SceneDefinition, ref: Ref, prefabs: PrefabLibrary): InstanceTransformModel | null;
```

Refers to [`InstanceTransformModel`](#instancetransformmodel), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `instanceZBatch`

_function_ in `editor/inspector-model.ts`

The batch setting a scene instance's `z` from a typed number or a
relative edit (`+=1`), checked against the instance schema. No ops when
the value doesn't change.

```ts
declare function instanceZBatch(model: InstanceTransformModel, text: string): {
    batch: OpBatch;
    ok: true;
} | {
    error: string;
    ok: false;
};
```

Refers to [`InstanceTransformModel`](#instancetransformmodel), [`OpBatch`](#opbatch).

## `instancesOf`

_function_ in `editor/prefab-commands.ts`

How many placements Apply to `prefab` changes, what its confirmation
counts. With `prefabs`, that takes in placements of its variants and
those nested in other prefabs; without, only the scene's own placements
of `prefab` itself.

```ts
declare function instancesOf(def: SceneDefinition, prefab: string, prefabs?: PrefabLibrary): number;
```

Refers to [`SceneDefinition`](#scenedefinition).

## `isBulkRef`

_function_ in `editor/refs.ts`

```ts
declare function isBulkRef(ref: Ref): boolean;
```

Refers to [`Ref`](#ref).

## `isFollowerType`

_function_ in `editor/attach.ts`

Whether entities of placeable `type` can be named by some placeable type's `attachField`.

```ts
declare function isFollowerType(registry: Registry, type: EntityTypeName): boolean;
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry).

## `isolationBounds`

_function_ in `editor/isolation.ts`

The scene a prefab is edited in: the parent scene's size centred on the
prefab's origin, grown to hold its children and its instances' origins.

```ts
declare function isolationBounds(prefab: Prefab, parent: Bounds, registry: EditorSession["registry"]): Bounds;
```

Refers to [`EditorSession`](#editorsession).

## `judgeConcave`

_function_ in `editor/gizmos/edit.ts`

`edit` without its `concave` flag when `t`'s field allows concave polygons.

```ts
declare function judgeConcave(edit: GizmoEdit | null, registry: Registry, t: GizmoTarget | undefined): GizmoEdit | null;
```

Refers to [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Registry`](#registry).

## `keyChord`

_function_ in `editor/keymap.ts`

The chord a key press makes: `Shift+`, `Alt+`, `Mod+` (Ctrl or Cmd), then the key.

```ts
declare function keyChord(e: EditorKeyEvent): string;
```

Refers to [`EditorKeyEvent`](#editorkeyevent).

## `labelFor`

_function_ in `editor/session.ts`

A history label for batches that don't bring their own.

```ts
declare function labelFor(batch: OpBatch): string;
```

Refers to [`OpBatch`](#opbatch).

## `lock45`

_function_ in `editor/builtin/polyline.ts`

`p` pulled onto the nearest 45° line through `from`, a whole number of world px along each axis.

```ts
declare function lock45(from: Pt, p: Pt, pxPerMetre: number): Pt;
```

Refers to [`Pt`](#pt).

## `lookupRef`

_function_ in `editor/refs.ts`

```ts
declare function lookupRef(def: SceneDefinition, ref: Ref): RefTarget | null;
```

Refers to [`Ref`](#ref), [`RefTarget`](#reftarget), [`SceneDefinition`](#scenedefinition).

## `marqueeSelect`

_function_ in `editor/picking.ts`

What a marquee over `rect` selects, topmost first: entries wholly inside
it, or with `touch` (Alt) any it or its sprite's box touches (a camera
region's outline, not its inside). Hidden and locked layers are skipped.

```ts
declare function marqueeSelect(index: SpatialIndex, rect: Aabb, opts: {
    layers?: PickLayers;
    touch: boolean;
}): Ref[];
```

Refers to [`Aabb`](#aabb), [`PickLayers`](#picklayers), [`Ref`](#ref), [`SpatialIndex`](#spatialindex).

## `modelBatch`

_function_ in `editor/inspector-model.ts`

`modelOps` as one undoable batch, with the `base` hash bulk refs need.

```ts
declare function modelBatch(field: ModelField, input: unknown, targets: readonly RefTarget[], def: SceneDefinition, registry?: Registry): {
    batch: OpBatch;
    ok: true;
} | {
    error: string;
    ok: false;
};
```

Refers to [`ModelField`](#modelfield), [`OpBatch`](#opbatch), [`RefTarget`](#reftarget), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `modelOps`

_function_ in `editor/inspector-model.ts`

The update ops that set `field` to `input` on each target, one per
target whose value changes. On a number field a string is parsed by
`parseRelative` against each target's own value (or the field's default
when unset), so `+=16` moves every one. A metric number or point is
written to micrometres (`roundLength`). `undefined` unsets an optional
field. With `registry`, a behavior field's edit on an entity also writes
what keeps its block valid (`behaviorFieldEdit`). Fails without ops when
any target's new value doesn't pass the field's schema.

```ts
declare function modelOps(field: ModelField, input: unknown, targets: readonly RefTarget[], registry?: Registry): ModelEdit;
```

Refers to [`ModelEdit`](#modeledit), [`ModelField`](#modelfield), [`RefTarget`](#reftarget), [`Registry`](#registry).

## `moveBatch`

_function_ in `editor/gizmos/batch.ts`

One `move` of `refs` by `delta`, on whole world px; `null` for no movement.

```ts
declare function moveBatch(refs: readonly Ref[], delta: Pt, pxPerMetre: number, label?: string): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Pt`](#pt), [`Ref`](#ref).

## `moveTarget`

_function_ in `editor/gizmos/drag.ts`

Moving one target by its move handle or body: the drag snaps (the box
edge nearest the grab) and becomes one `move`, which carries a path with
it. With Alt, a target on a path re-bases waypoint 0 instead.

```ts
declare function moveTarget(t: GizmoTarget, from: Pt, to: Pt, opts: DragOptions): GizmoEdit;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `moveVertex`

_function_ in `editor/gizmos/vertices.ts`

`s` with point `index` at `at`.

```ts
declare function moveVertex(s: PointShape, index: number, at: Pt): PointShape;
```

Refers to [`PointShape`](#pointshape), [`Pt`](#pt).

## `nestedInstanceOf`

_function_ in `editor/prefab-commands.ts`

A nested instance a resolved ref names (`room-1/door-1`): the instance
inside its prefab, the prefab that holds it, and its path below the
scene's instance (`door-1`). Null for a scene instance, an entity child
or an unknown ref.

```ts
declare function nestedInstanceOf(def: SceneDefinition, ref: Ref, prefabs: PrefabLibrary): null | {
    holder: string;
    instance: InstanceDef;
    path: string;
    top: InstanceDef;
};
```

Refers to [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `nextFreeId`

_function_ in `scene/fragment.ts`

`id` when it's free, else the next free `<stem>-<n>` (`lift` → `lift-2`, `lift-2` → `lift-3`), at most 48 characters.

```ts
declare function nextFreeId(id: string, taken: ReadonlySet<string>): string;
```

## `nextGroupName`

_function_ in `editor/commands.ts`

The first `group-<n>` no entity uses.

```ts
declare function nextGroupName(def: SceneDefinition): string;
```

Refers to [`SceneDefinition`](#scenedefinition).

## `normDeg`

_function_ in `editor/gizmos/batch.ts`

Degrees in [0, 360).

```ts
declare function normDeg(deg: number): number;
```

## `normalizeChord`

_function_ in `editor/keymap.ts`

A chord written in any modifier order (or with `" "` for Space) in canonical form; throws on an unknown modifier.

```ts
declare function normalizeChord(chord: string): string;
```

## `nudgeBatch`

_function_ in `editor/commands.ts`

One batch moving `refs` by `delta`, on whole world px; `null` when nothing moves.

```ts
declare function nudgeBatch(refs: readonly Ref[], delta: Pt, pxPerMetre: number): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Pt`](#pt), [`Ref`](#ref).

## `nudgeDelta`

_function_ in `editor/commands.ts`

The offset, in metres, a `nudge-<dir>[-coarse|-fine]` command moves by:
one world px at `pxPerMetre` (also with `-fine`), ten with `-coarse`.
`null` for any other command.

```ts
declare function nudgeDelta(command: string, pxPerMetre: number): Pt | null;
```

Refers to [`Pt`](#pt).

## `numberBounds`

_function_ in `editor/inspector.ts`

What a number schema allows, read from its JSON Schema form.

```ts
declare function numberBounds(s: z.ZodNumber): NumberBounds;
```

Refers to [`NumberBounds`](#numberbounds).

## `onePixel`

_function_ in `editor/snap.ts`

One world px at `pxPerMetre`, in metres: the smallest size an editor edit writes.

```ts
declare function onePixel(pxPerMetre: number): number;
```

## `openPrefabIsolation`

_function_ in `editor/isolation.ts`

Opens `prefab` for editing on its own: a session over the prefab's doc,
from the scene session's prefab source, read at its local coordinates
around the origin. Every edit lands in that doc, so each instance
follows and collaborators in the prefab see each other. The instances
it holds show resolved like a scene's, their children by `door-1/panel`;
an edit to one is an override in this prefab, and an instance that
would contain the prefab itself is refused with `prefab-cycle`. Ops that
only mean something in a scene, and children joining a group, are
refused with `op-invalid`. Null when the source has no such prefab to open.

```ts
declare function openPrefabIsolation(scene: EditorSession, prefab: string, opts?: PrefabIsolationOptions): Promise<PrefabIsolation | null>;
```

Refers to [`EditorSession`](#editorsession), [`PrefabIsolation`](#prefabisolation), [`PrefabIsolationOptions`](#prefabisolationoptions).

## `outlineOrder`

_function_ in `editor/outline.ts`

The selectable refs in outline order, for range selection.

```ts
declare function outlineOrder(rows: readonly OutlineRow[]): Ref[];
```

Refers to [`OutlineRow`](#outlinerow), [`Ref`](#ref).

## `overridePathsOf`

_function_ in `editor/prefab-commands.ts`

The override keys a ref covers on its scene instance: every one for the
instance itself; for a child (`room-1/door-1/panel` or a nested instance
`room-1/door-1`), those naming it and, for a nested instance, its children.

```ts
declare function overridePathsOf(def: SceneDefinition, ref: Ref): OverridePath[];
```

Refers to [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `panTool`

_const_ in `editor/builtin/transform.ts`

The pan tool (`H`, or Space held): a drag moves the view with the
pointer through the host's camera.

```ts
declare const panTool: {
    create(ctx: EditorToolContext): {
        cancel(): boolean;
        cursor: () => "grab" | "grabbing";
        gesture: () => boolean;
        pointer(e: ToolPointerEvent): boolean;
    };
    description: string;
    id: string;
    label: string;
};
```

Refers to [`EditorToolContext`](#editortoolcontext), [`ToolPointerEvent`](#toolpointerevent).

## `paramBatch`

_function_ in `editor/inspector-model.ts`

The batch that sets `param` (or one field inside it) to `input` on the
instance, parsed and checked as `modelOps` does: `setParam` on a scene
instance (undefined clears it), an override of `<nested>.params.<name>`
on the scene instance for a nested one. Written against the document.

```ts
declare function paramBatch(model: InstanceParamsModel, param: ParamModel, input: unknown, field?: ModelField): {
    batch: OpBatch;
    ok: true;
} | {
    error: string;
    ok: false;
};
```

Refers to [`InstanceParamsModel`](#instanceparamsmodel), [`ModelField`](#modelfield), [`OpBatch`](#opbatch), [`ParamModel`](#parammodel).

## `parseFragment`

_function_ in `scene/fragment.ts`

Parses a fragment from clipboard text or a parsed value: a stale `v` is
lifted by the scene migrations, then the fragment is checked against the
registry's scene schema. A fragment naming another game fails with
`unknown-game`; one naming none is judged by `registry`. Never throws.

```ts
declare function parseFragment(input: unknown, registry: Registry, opts?: ParseOptions): ParseFragmentResult;
```

Refers to [`ParseFragmentResult`](#parsefragmentresult), [`Registry`](#registry).

## `parseRelative`

_function_ in `editor/inspector-model.ts`

A number typed into a field: a plain number, or a relative edit applied
to `current` (`+=16`, `-=8`, `*=2`, `/=2`). Undefined when it's neither,
or relative with no current number.

```ts
declare function parseRelative(text: string, current: unknown): number | undefined;
```

## `pasteFragment`

_function_ in `editor/clipboard.ts`

The batch that pastes clipboard text into `def`: the fragment's box
centred under `at` and snapped, ids that clash renamed (`lift` →
`lift-2`), references inside the fragment following the renames, and
references out of it kept when their target exists in `def`, else
cleared with a `dangling-ref` warning. Instances keep their prefab,
params and overrides under a fresh id when theirs is taken; one whose
prefab isn't in `prefabs` is left out with a `prefab-unknown` warning.
One batch of `addBulk`, `add` and `instantiate` ops; `select` names what
it adds.

```ts
declare function pasteFragment(input: SceneFragment | string, opts: PasteOptions): PasteResult;
```

Refers to [`PasteOptions`](#pasteoptions), [`PasteResult`](#pasteresult), [`SceneFragment`](#scenefragment).

## `pathBatch`

_function_ in `editor/gizmos/batch.ts`

One `update` replacing the waypoints of `t`'s path, rounded.

```ts
declare function pathBatch(t: GizmoTarget, pts: readonly Pt[], pxPerMetre: number, label?: string): OpBatch | null;
```

Refers to [`GizmoTarget`](#gizmotarget), [`OpBatch`](#opbatch), [`Pt`](#pt).

## `penTool`

_const_ in `editor/builtin/polyline.ts`

```ts
declare const penTool: {
    create(ctx: EditorToolContext): {
        cancel?(): boolean;
        command: (command: (string & {}) | EditorCommand) => boolean;
        cursor?(): string | undefined;
        destroy?(): void;
        gesture?(): boolean;
        key?(e: ToolKeyEvent): boolean;
        overlay(): ToolOverlay;
        pointer?(e: ToolPointerEvent): boolean;
        subObject?(): boolean;
    };
    description: string;
    id: string;
    label: string;
};
```

Refers to [`EditorCommand`](#editorcommand), [`EditorToolContext`](#editortoolcontext), [`ToolKeyEvent`](#toolkeyevent), [`ToolOverlay`](#tooloverlay), [`ToolPointerEvent`](#toolpointerevent).

## `pickAt`

_function_ in `editor/picking.ts`

Every entry under `p` (its geometry, a camera region's outline, or the box
its sprite draws), topmost first, skipping hidden and locked layers.

```ts
declare function pickAt(index: SpatialIndex, p: Pt, opts: PickOptions): IndexEntry[];
```

Refers to [`IndexEntry`](#indexentry), [`PickOptions`](#pickoptions), [`Pt`](#pt), [`SpatialIndex`](#spatialindex).

## `pixelSize`

_function_ in `editor/snap.ts`

A size on whole world px, at least one.

```ts
declare function pixelSize(m: number, pxPerMetre: number): number;
```

## `placedShape`

_function_ in `editor/placement.ts`

A template's local shape turned by `rotDeg` about its origin and moved to `at`.

```ts
declare function placedShape(shape: ShapeObj, at: Pt, rotDeg: number): ShapeObj;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `placementEditorTool`

_function_ in `editor/placement.ts`

An editor tool that places templates as scene entities: `tool:<id>:<template>`
picks one, the ghost follows the snapped pointer, the wheel (or the
rotate commands) turns a rotatable one by the snap angle, a left click
commits one `add` batch, and right click or Escape drops the template
without a batch.

```ts
declare function placementEditorTool<T extends PlacementTemplate>(opts: PlacementEditorToolOptions<T>): EditorToolDef;
```

Refers to [`EditorToolDef`](#editortooldef), [`PlacementEditorToolOptions`](#placementeditortooloptions), [`PlacementTemplate`](#placementtemplate).

## `pointBatch`

_function_ in `editor/gizmos/batch.ts`

One `update` moving a point entity to `at`, rounded.

```ts
declare function pointBatch(t: GizmoTarget, at: Pt, pxPerMetre: number, label?: string): OpBatch | null;
```

Refers to [`GizmoTarget`](#gizmotarget), [`OpBatch`](#opbatch), [`Pt`](#pt).

## `projectHistory`

_function_ in `editor/session.ts`

History backed by the project session's undo coordinator, for an editor
on one of its docs: undo steps back through this client's last step
wherever it was (`onUndone` hears of each, to say where), and the rows
are the doc's log merged with the project entries that name it. Open
`docName` in the project session first, and give the editor session the
project's origin. While subscribed, the docs those project entries wrote
stay open, so Revert can write them all.

```ts
declare function projectHistory(project: ProjectSession, docName: string, opts?: {
    onUndone?: (step: UndoneStep, how: "redo" | "undo") => void;
}): SessionHistory;
```

Refers to [`SessionHistory`](#sessionhistory).

## `prune`

_function_ in `editor/selection.ts`

Drops refs the document no longer has.

```ts
declare function prune(sel: readonly Ref[], existing: Iterable<Ref>): Ref[];
```

Refers to [`Ref`](#ref).

## `quarterTurnTargets`

_function_ in `editor/commands.ts`

What a turn or flip of `refs` acts on in `def` (the document, not the
resolved view): instances and whole groups, which turn by quarter turns
and flip exactly.

```ts
declare function quarterTurnTargets(def: SceneDefinition, refs: readonly Ref[]): QuarterTurnTargets;
```

Refers to [`QuarterTurnTargets`](#quarterturntargets), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `radiusTo`

_function_ in `editor/gizmos/drag.ts`

A circle's or capsule's radius from its `radius` handle, on whole world px.

```ts
declare function radiusTo(s: Extract<ShapeObj, {
    type: "capsule" | "circle";
}>, to: Pt, pxPerMetre: number): ShapeObj;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `readAngle`

_const_ in `editor/gizmos/readout.ts`

`37°`

```ts
declare const readAngle: (deg: number) => string;
```

## `readDelta`

_const_ in `editor/gizmos/readout.ts`

`Δ 0.64, 0 m`

```ts
declare const readDelta: ([dx, dy]: Pt, pxPerMetre: number) => string;
```

Refers to [`Pt`](#pt).

## `readLength`

_const_ in `editor/gizmos/readout.ts`

`L 1.2 m`: a capsule's full length, caps included.

```ts
declare const readLength: (len: number, pxPerMetre: number) => string;
```

## `readPoint`

_const_ in `editor/gizmos/readout.ts`

`6.4, 3.2 m`: where a new point lands.

```ts
declare const readPoint: ([x, y]: Pt, pxPerMetre: number) => string;
```

Refers to [`Pt`](#pt).

## `readRadius`

_const_ in `editor/gizmos/readout.ts`

`R 0.2 m`

```ts
declare const readRadius: (r: number, pxPerMetre: number) => string;
```

## `readShapeSize`

_function_ in `editor/gizmos/readout.ts`

A committed shape's size, as the resize readouts print it.

```ts
declare function readShapeSize(s: ShapeObj, pxPerMetre: number): string;
```

Refers to [`ShapeObj`](#shapeobj).

## `readSize`

_const_ in `editor/gizmos/readout.ts`

`W 1.6 H 0.16 m`

```ts
declare const readSize: (w: number, h: number, pxPerMetre: number) => string;
```

## `rebasePath`

_function_ in `editor/gizmos/waypoints.ts`

Alt-dragging the follower itself: waypoint 0 moves and the rest of the path
stays, so the path starts somewhere new. A plain drag moves the whole
path (a `move` op).

```ts
declare function rebasePath(t: GizmoTarget, from: Pt, to: Pt, opts: DragOptions): GizmoEdit | null;
```

Refers to [`DragOptions`](#dragoptions), [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `refCandidates`

_function_ in `editor/inspector-model.ts`

Refs an entity-ref field may name: entities whose type, or its base, is
in `accepts`. With `prefabs`, instances' children count too, by their
resolved refs (`gate-2/door`) at any depth.

```ts
declare function refCandidates(def: SceneDefinition, registry: Registry, accepts: readonly EntityTypeName[], prefabs?: PrefabLibrary): string[];
```

Refers to [`EntityTypeName`](#entitytypename), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `referableEntities`

_function_ in `editor/refs.ts`

The entities a reference field may name: the document's own and, with
`prefabs`, every instance's children by their resolved refs
(`gate-2/door`, `room-1/door-1/panel`).

```ts
declare function referableEntities(def: SceneDefinition, registry: Registry, prefabs?: PrefabLibrary): EntityDef[];
```

Refers to [`EntityDef`](#entitydef), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `remap`

_function_ in `editor/selection.ts`

Follows renames and shifted bulk indices; a ref mapped to `null` is dropped.

```ts
declare function remap(sel: readonly Ref[], renames: Readonly<Record<Ref, Ref | null>> | ReadonlyMap<Ref, Ref | null>): Ref[];
```

Refers to [`Ref`](#ref).

## `removeVertices`

_function_ in `editor/gizmos/vertices.ts`

Deleting vertices `indices`; `null` (refused) when that would leave a poly under 3 or a chain under 2.

```ts
declare function removeVertices(t: GizmoTarget, indices: readonly number[], pxPerMetre: number): GizmoEdit | null;
```

Refers to [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget).

## `removeWaypoints`

_function_ in `editor/gizmos/waypoints.ts`

Deleting waypoints `indices`; `null` (refused) when fewer than 2 would be left.

```ts
declare function removeWaypoints(t: GizmoTarget, indices: readonly number[], pxPerMetre: number): GizmoEdit | null;
```

Refers to [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget).

## `resizeBox`

_function_ in `editor/gizmos/drag.ts`

A box resized by dragging its `dir` handle to `to`: the opposite edge
stays put, or with `alt` the centre does; `shift` keeps the aspect ratio.
All of it in the box's own (rotated) frame. Half-extents come out on
whole world px and at least one, so a whole-pixel anchor stays exactly
where it was; an unrotated box's moving edge snaps to the grid.

```ts
declare function resizeBox(b: Box, dir: ResizeDir, to: Pt, opts: {
    alt: boolean;
    bypass?: boolean;
    pxPerMetre: number;
    shift: boolean;
    snap?: SnapSettings;
}): Box;
```

Refers to [`Pt`](#pt), [`ResizeDir`](#resizedir), [`SnapSettings`](#snapsettings).

## `resizeCursor`

_function_ in `editor/gizmos/handles.ts`

The CSS resize cursor for dragging along world direction `v`.

```ts
declare function resizeCursor([x, y]: Pt): string;
```

Refers to [`Pt`](#pt).

## `revertAllBatch`

_function_ in `editor/prefab-commands.ts`

Drops every override a ref covers (`overridePathsOf`): all of an instance's, or a nested child's.

```ts
declare function revertAllBatch(def: SceneDefinition, ref: Ref): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `revertFieldBatch`

_function_ in `editor/prefab-commands.ts`

Drops the overrides behind one field of an instance child, back to the prefab's value.

```ts
declare function revertFieldBatch(def: SceneDefinition, ref: Ref, field: string): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `rotateByHandle`

_function_ in `editor/gizmos/drag.ts`

A shape turned by the rotate handle. A box or capsule snaps its absolute
`rotDeg` to the step (Shift: free) and lands in [0, 360); a poly or chain
snaps the turn and rotates about its centroid. Circles don't rotate.

```ts
declare function rotateByHandle(s: ShapeObj, from: Pt, to: Pt, snap: SnapSettings, free: boolean): {
    deg: number;
    shape: ShapeObj;
};
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj), [`SnapSettings`](#snapsettings).

## `rotateSelectionBatch`

_function_ in `editor/commands.ts`

One batch turning the selection `deg` degrees (clockwise on screen) about its pivot.

```ts
declare function rotateSelectionBatch(def: SceneDefinition, registry: Registry, refs: readonly Ref[], deg: number): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `rotateTargetsBatch`

_function_ in `editor/gizmos/multi.ts`

One batch turning every target `deg` degrees about `about`: shapes turn
about it (boxes and capsules also turn their `rotDeg`), points orbit it,
and a target on a path has its waypoints orbit and its local shape turn
with them. `null` when rounding leaves everything as it was.

```ts
declare function rotateTargetsBatch(targets: readonly GizmoTarget[], about: Pt, deg: number, pxPerMetre: number, label?: string): OpBatch | null;
```

Refers to [`GizmoTarget`](#gizmotarget), [`OpBatch`](#opbatch), [`Pt`](#pt).

## `rotateTool`

_const_ in `editor/builtin/transform.ts`

The rotate tool (`R`): a drag anywhere turns the selection about its
centre, snapped to the snap angle (Shift: free), as one batch on release.
With nothing selected a click selects the topmost entity.

```ts
declare const rotateTool: {
    create(ctx: EditorToolContext): {
        cancel(): boolean;
        cursor: () => "grab" | "grabbing";
        gesture: () => boolean;
        overlay(): ToolOverlay;
        pointer(e: ToolPointerEvent): boolean;
    };
    description: string;
    id: string;
    label: string;
};
```

Refers to [`EditorToolContext`](#editortoolcontext), [`ToolOverlay`](#tooloverlay), [`ToolPointerEvent`](#toolpointerevent).

## `rotationPivot`

_function_ in `editor/commands.ts`

What a selection turns about: one shape's pivot, else the centre of the box around all of it.

```ts
declare function rotationPivot(targets: readonly GizmoTarget[]): Pt | null;
```

Refers to [`GizmoTarget`](#gizmotarget), [`Pt`](#pt).

## `roundPt`

_function_ in `editor/snap.ts`

Both coordinates, in metres, on the nearest whole world px at `pxPerMetre`, without `-0`.

```ts
declare function roundPt([x, y]: Pt, pxPerMetre: number): Pt;
```

Refers to [`Pt`](#pt).

## `roundShape`

_function_ in `editor/gizmos/batch.ts`

Whole world px everywhere (metres, at `pxPerMetre`), sizes at least one
px, whole degrees: what every commit writes.

```ts
declare function roundShape(s: ShapeObj, pxPerMetre: number): ShapeObj;
```

Refers to [`ShapeObj`](#shapeobj).

## `select`

_function_ in `editor/selection.ts`

The next selection. `range` replaces it with everything in `order`
between the anchor (the last selected ref) and `refs[0]`, and keeps the
anchor last so the next range starts from the same place. Without an
anchor in `order` it selects `refs[0]` alone.

```ts
declare function select(sel: readonly Ref[], refs: readonly Ref[], mode: SelectMode, order?: readonly Ref[]): Ref[];
```

Refers to [`Ref`](#ref), [`SelectMode`](#selectmode).

## `selectAllRefs`

_function_ in `editor/commands.ts`

Every ref in the document, in file order, except those on a hidden or locked layer.

```ts
declare function selectAllRefs(def: SceneDefinition, index: SpatialIndex, layers?: PickLayers): Ref[];
```

Refers to [`PickLayers`](#picklayers), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition), [`SpatialIndex`](#spatialindex).

## `selectTool`

_const_ in `editor/builtin/select.ts`

The select tool (`V`): click, Shift-add, Mod-toggle, Alt-cycle and marquee
selection; dragging moves the selection; handles resize and rotate one
entity, or move and rotate a multi-selection; a double-click (or the
host's `enter-sub-object`) edits a poly's, chain's or path's points. Each
drag previews and commits one batch on release.

```ts
declare const selectTool: {
    create(ctx: EditorToolContext): {
        cancel(): boolean;
        command(command: (string & {}) | EditorCommand): boolean;
        cursor(): string | undefined;
        destroy(): void;
        gesture: () => boolean;
        overlay(): ToolOverlay;
        pointer(e: ToolPointerEvent): boolean;
        subObject: () => boolean;
    };
    description: string;
    id: string;
    label: string;
};
```

Refers to [`EditorCommand`](#editorcommand), [`EditorToolContext`](#editortoolcontext), [`ToolOverlay`](#tooloverlay), [`ToolPointerEvent`](#toolpointerevent).

## `selectionBounds`

_function_ in `editor/commands.ts`

The box around what the selection outlines (`outlineBounds` with the
registry's look), an instance by its children: the box the selection's
outline, its gizmo and a tool's offer sit on. `null` when nothing in it
draws. Framing goes by `frameBounds`, which also takes in the paths movers
travel.

```ts
declare function selectionBounds(def: SceneDefinition, registry: Registry, refs: readonly Ref[]): Aabb | null;
```

Refers to [`Aabb`](#aabb), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `selectionBox`

_function_ in `editor/gizmos/multi.ts`

The box around every target, which a multi-selection's gizmo frames.

```ts
declare function selectionBox(targets: readonly GizmoTarget[]): Aabb;
```

Refers to [`Aabb`](#aabb), [`GizmoTarget`](#gizmotarget).

## `selectionHandles`

_function_ in `editor/gizmos/handles.ts`

A multi-selection's one gizmo: move at the box's centre and a rotate stalk above it. No resize.

```ts
declare function selectionHandles(box: Aabb, scale: number): GizmoHandle[];
```

Refers to [`Aabb`](#aabb), [`GizmoHandle`](#gizmohandle).

## `setHover`

_function_ in `editor/store.ts`

Sets the shared hover; a no-op when it's already `ref`, so pointer moves don't re-render the panels.

```ts
declare function setHover(store: Store<EditorStoreState>, ref: Ref | null): void;
```

Refers to [`EditorStoreState`](#editorstorestate), [`Ref`](#ref).

## `settingsEdit`

_function_ in `editor/settings-model.ts`

One `editAsset` op setting the field at dot `path` on `asset` to `value`
(`undefined` unsets it). With the doc as it is now and its kind's
layout, the op writes where the layout allows: a value inside an atomic
one (`engine.resolution.fit`) sets that whole value, and a field under a
missing object sets the object; unsetting under a missing object is no
edit at all.

```ts
declare function settingsEdit(asset: AssetId, path: string, value: unknown, current?: {
    doc: unknown;
    layout: DocLayout;
}): ProjectOp;
```

## `settingsRows`

_function_ in `editor/settings-model.ts`

Rows for every field of `schema`, an object whose value is `value` and
which sits at `path` in its doc (`""` for the doc's root): row paths are
full dot paths from the doc's root, as `settingsEdit` takes them. Nested
objects carry their fields as children; enums, bounded numbers,
booleans and number pairs get the widgets the scene inspector gives them.

```ts
declare function settingsRows(schema: z.ZodObject, value: unknown, path: string, options?: SettingsRowsOptions): InspectorRow[];
```

Refers to [`InspectorRow`](#inspectorrow), [`SettingsRowsOptions`](#settingsrowsoptions).

## `settingsValue`

_function_ in `editor/settings-model.ts`

What `input` sets `row` to, checked: typed text parsed and rounded as the
scene inspector does, `undefined` only for an optional row, and the
result passing the row's schema.

```ts
declare function settingsValue(row: InspectorRow, input: unknown): {
    error: string;
    ok: false;
} | {
    ok: true;
    value: unknown;
};
```

Refers to [`InspectorRow`](#inspectorrow).

## `shapeBatch`

_function_ in `editor/gizmos/batch.ts`

One `update` giving `t` the world shape `world`; `null` when rounding
leaves it as it was. Batches carry no `base`: the session fills it in for
bulk refs.

```ts
declare function shapeBatch(t: GizmoTarget, world: ShapeObj, pxPerMetre: number, label?: string): OpBatch | null;
```

Refers to [`GizmoTarget`](#gizmotarget), [`OpBatch`](#opbatch), [`ShapeObj`](#shapeobj).

## `shapeConversions`

_function_ in `editor/inspector-model.ts`

What the shape tag switcher offers for `tuple`: each of `types` other
than its own, converted, and whether converting is lossless (an
axis-aligned box to a poly and back) or what it loses. Converted points
and sizes land on whole world px at the game's `pxPerMetre`.

```ts
declare function shapeConversions(tuple: ShapeTuple, types?: readonly ShapeType[], pxPerMetre?: number): ShapeConversion[];
```

Refers to [`ShapeConversion`](#shapeconversion), [`ShapeTuple`](#shapetuple).

## `shapeEdit`

_function_ in `editor/gizmos/edit.ts`

A gesture that gives `t` the world shape `world`, rounded as it will commit.

```ts
declare function shapeEdit(t: GizmoTarget, world: ShapeObj, pxPerMetre: number, label: string, readout?: string): GizmoEdit;
```

Refers to [`GizmoEdit`](#gizmoedit), [`GizmoTarget`](#gizmotarget), [`ShapeObj`](#shapeobj).

## `shapeHandles`

_function_ in `editor/gizmos/handles.ts`

A shape's handles, at a constant screen size for `scale` (screen px per
metre): move at the pivot; a box's eight resize handles and rotate
stalk; a circle's radius; a capsule's half-length, radius and rotate; a
poly's or chain's rotate. Later handles draw over earlier ones.

```ts
declare function shapeHandles(s: ShapeObj, scale: number): GizmoHandle[];
```

Refers to [`GizmoHandle`](#gizmohandle), [`ShapeObj`](#shapeobj).

## `shapePivot`

_function_ in `editor/gizmos/handles.ts`

What a shape turns about: a box's, circle's or capsule's centre, a poly's or chain's centroid.

```ts
declare function shapePivot(s: ShapeObj): Pt;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj).

## `shapeSet`

_function_ in `editor/gizmos/batch.ts`

The `set` that gives `t` the world shape `world`, rounded, as a tuple;
local to the path's first point when `t` rides a path. `null` when
nothing would change.

```ts
declare function shapeSet(t: GizmoTarget, world: ShapeObj, pxPerMetre: number): Record<string, unknown> | null;
```

Refers to [`GizmoTarget`](#gizmotarget), [`ShapeObj`](#shapeobj).

## `shapeSlots`

_function_ in `editor/inspector.ts`

The number slots of a box, circle or capsule tuple; null for polygons and chains.

```ts
declare function shapeSlots(tuple: ShapeTuple): ShapeSlot[] | null;
```

Refers to [`ShapeSlot`](#shapeslot), [`ShapeTuple`](#shapetuple).

## `snapAngle`

_function_ in `editor/snap.ts`

An angle on the nearest `angleDeg` step; `free` (Shift) leaves it as it is.

```ts
declare function snapAngle(deg: number, settings: SnapSettings, free: boolean): number;
```

Refers to [`SnapSettings`](#snapsettings).

## `snapDraggedPoint`

_function_ in `editor/gizmos/edit.ts`

Where a dragged point lands: `start` plus the pointer's offset, snapped
like a move (grid, then other entities' geometry) unless mod bypasses it.

```ts
declare function snapDraggedPoint(t: GizmoTarget, start: Pt, from: Pt, to: Pt, opts: DragOptions): {
    at: Pt;
    guides: SnapGuide[];
};
```

Refers to [`DragOptions`](#dragoptions), [`GizmoTarget`](#gizmotarget), [`Pt`](#pt), [`SnapGuide`](#snapguide).

## `snapMove`

_function_ in `editor/snap.ts`

A drag's offset, snapped per axis. The moved box's edge nearest the grab
point is what snaps, never its centre. It goes to the closest of: the
nearest grid line, and other entities' edges, vertices and centres
within `SNAP_PX` screen px; ties go to the grid, then edges and
vertices, then centres. Each snapped axis gives a guide. `enabled:
false` turns all of it off; `geometry: false` leaves only the grid.

```ts
declare function snapMove(input: SnapMoveInput): SnapMoveResult;
```

Refers to [`SnapMoveInput`](#snapmoveinput), [`SnapMoveResult`](#snapmoveresult).

## `snapPoint`

_function_ in `editor/snap.ts`

`p` on the nearest grid point; with `bypass` (Ctrl/Cmd) or snapping off, only on whole world px.

```ts
declare function snapPoint(p: Pt, settings: SnapSettings, pxPerMetre: number, opts?: {
    bypass?: boolean;
}): Pt;
```

Refers to [`Pt`](#pt), [`SnapSettings`](#snapsettings).

## `snapToGrid`

_function_ in `editor/snap.ts`

`v` on the nearest line of a grid `step` metres apart, landing on a whole world px.

```ts
declare function snapToGrid(v: number, step: number, pxPerMetre: number): number;
```

## `strokeFit`

_function_ in `editor/builtin/polyline.ts`

What `type`'s shape field takes; nothing for a type with none.

```ts
declare function strokeFit(registry: Registry, type: string): StrokeFit;
```

Refers to [`Registry`](#registry), [`StrokeFit`](#strokefit).

## `strokeShape`

_function_ in `editor/builtin/polyline.ts`

The shape a finished pen stroke makes: an open chain, or when closed on
its first point a poly if convex. A concave closed stroke stays a poly
where the field takes concave polys, else becomes a closed chain (its
first point repeated at the end) where it takes chains, else stays a
poly for validation to judge.

```ts
declare function strokeShape(pts: readonly Pt[], closed: boolean, fit?: StrokeFit): ShapeObj;
```

Refers to [`Pt`](#pt), [`ShapeObj`](#shapeobj), [`StrokeFit`](#strokefit).

## `takesConcave`

_function_ in `editor/gizmos/edit.ts`

Whether `t`'s shape field takes concave polygons, so a concave edit of it is no fault.

```ts
declare function takesConcave(registry: Registry, t: GizmoTarget): boolean;
```

Refers to [`GizmoTarget`](#gizmotarget), [`Registry`](#registry).

## `targetBox`

_function_ in `editor/gizmos/target.ts`

A target's world box: its shape's, or its point's.

```ts
declare function targetBox(t: GizmoTarget): Aabb;
```

Refers to [`Aabb`](#aabb), [`GizmoTarget`](#gizmotarget).

## `targetHandles`

_function_ in `editor/gizmos/handles.ts`

Every handle of one selected target. Normally its shape's handles (or a
point's move handle), with its path's waypoints drawn under them, so
waypoint 0 sits beneath the move handle, and its behaviors' handles
under both, so the entity's own win where they meet. In sub-object mode a path's
waypoints and inserts, or else a poly's or chain's vertices and inserts.

```ts
declare function targetHandles(t: GizmoTarget, opts: {
    scale: number;
    subObject?: boolean;
}): GizmoHandle[];
```

Refers to [`GizmoHandle`](#gizmohandle), [`GizmoTarget`](#gizmotarget).

## `targetsOf`

_function_ in `editor/commands.ts`

The selection's editable targets, in selection order; refs without geometry are left out.

```ts
declare function targetsOf(def: SceneDefinition, registry: Registry, refs: readonly Ref[]): GizmoTarget[];
```

Refers to [`GizmoTarget`](#gizmotarget), [`Ref`](#ref), [`Registry`](#registry), [`SceneDefinition`](#scenedefinition).

## `toolKeyEventOf`

_function_ in `editor/tool-host.ts`

A router key event as a tool sees it.

```ts
declare function toolKeyEventOf(e: Extract<ToolEvent, {
    kind: "key";
}>): ToolKeyEvent;
```

Refers to [`ToolKeyEvent`](#toolkeyevent).

## `turnBatch`

_function_ in `editor/commands.ts`

One batch turning the selected instances and whole groups a quarter turn
(`turn` 1 clockwise on screen, -1 counter-clockwise), each about its own
`at`. Plain entities in the selection are left out; `null` when nothing
is left.

```ts
declare function turnBatch(def: SceneDefinition, refs: readonly Ref[], turn: -1 | 1): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `ungroupBatch`

_function_ in `editor/commands.ts`

One batch taking the selected entities out of their groups; `null` when none is in one.

```ts
declare function ungroupBatch(def: SceneDefinition, refs: readonly Ref[]): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `unpackBatch`

_function_ in `editor/prefab-commands.ts`

```ts
declare function unpackBatch(def: SceneDefinition, ref: Ref): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref), [`SceneDefinition`](#scenedefinition).

## `vertexHandles`

_function_ in `editor/gizmos/handles.ts`

Point editing: a square per vertex and a `+` at each segment's midpoint (a poly's closing one too).

```ts
declare function vertexHandles(s: ShapeObj): GizmoHandle[];
```

Refers to [`GizmoHandle`](#gizmohandle), [`ShapeObj`](#shapeobj).

## `waypointHandles`

_function_ in `editor/gizmos/handles.ts`

A path's waypoint handles; with `inserts`, a `+` at each segment's
midpoint, and a loop's closing segment.

```ts
declare function waypointHandles(pts: readonly Pt[], opts: {
    inserts: boolean;
    loop?: boolean;
}): GizmoHandle[];
```

Refers to [`GizmoHandle`](#gizmohandle), [`Pt`](#pt).

## `waypointsTool`

_const_ in `editor/builtin/polyline.ts`

The waypoint tool (`W`): with one path-following entity selected, a stroke
of clicks replaces its path's waypoints in one batch. With none selected,
a click selects the topmost one under the pointer.

```ts
declare const waypointsTool: {
    create(ctx: EditorToolContext): EditorTool;
    description: string;
    id: string;
    label: string;
};
```

Refers to [`EditorTool`](#editortool), [`EditorToolContext`](#editortoolcontext).

## `withShapeSlot`

_function_ in `editor/inspector.ts`

The tuple with one slot replaced.

```ts
declare function withShapeSlot(tuple: ShapeTuple, index: number, value: number): ShapeTuple;
```

Refers to [`ShapeTuple`](#shapetuple).

## `zOrderBatch`

_function_ in `editor/commands.ts`

One batch raising (`by` 1, bring forward) or lowering (`by` -1, send
backward) the `z` of the selected entities and instances. Bulk entries,
including an instance's bulk children, carry no `z` and are left out;
`null` when nothing is left.

```ts
declare function zOrderBatch(refs: readonly Ref[], by: -1 | 1): OpBatch | null;
```

Refers to [`OpBatch`](#opbatch), [`Ref`](#ref).
