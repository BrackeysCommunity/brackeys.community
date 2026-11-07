/** Scene format v1: parse, validate, format, hash, expand, and the `SceneOp` command language. Server-safe. */
export * from "./types";
export { EntityDefSchema, entitySchemaFor, ID_PATTERN, SceneV1 } from "./schema";
export {
  parseScene,
  parseSceneOrThrow,
  pointerLines,
  SceneParseError,
  SceneVersionError,
  type ParseSceneResult,
} from "./parse";
export { parseShape, shapeToTuple, ShapeTupleSchema, type ParseShapeResult } from "./shapes";
export {
  aabb,
  aabbUnion,
  boxCorners,
  centroid,
  containsPoint,
  isConvex,
  topSpan,
  translateShape,
} from "./shape-geometry";
export { bulkId, expandScene, parseBulkId } from "./expand";
export { formatScene } from "./format";
export { sceneHash } from "./hash";
export { closest } from "./did-you-mean";
export { validateScene, type ValidateOptions } from "./validate";
export { ISSUE_CODES, type IssueCodeInfo } from "./issues";
export { sceneJsonSchema, SCHEMA_ID_BASE } from "./json-schema";
export { applyOps } from "./ops";
export { OpBatchSchema, OPS_SCHEMA_ID, opsJsonSchema, SceneOpSchema } from "./ops-schema";
export { describeChange, diffScenes } from "./diff";
