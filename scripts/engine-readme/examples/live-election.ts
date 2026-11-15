import { electResponder } from "@jams/engine/collab";

/** Two editors have the scene open with Let agents drive Play on; the lower client id answers. */
export const responder = electResponder([
  { clientId: 41, live: true },
  { clientId: 7 },
  { clientId: 12, live: true },
]);
