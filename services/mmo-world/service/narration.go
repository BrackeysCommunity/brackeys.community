package service

import (
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/envvar"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/sheets"
)

// arcSchema is the story.arcs row schema as the sheets root checks it in.
// The harness writes it; the service only reads it.
var arcSchema = filepath.Join("sheets", "schema", "story.arcs.schema.json")

// arcKit is what a proposed story.arcs row may name (GDD 12.9): the
// templates there are, the registered predicates, the effect kinds and the
// row schema. A proposal is a row, never code.
func (s *Server) arcKit(w http.ResponseWriter, r *http.Request) {
	schema, err := os.ReadFile(filepath.Join(envvar.Get(EnvSheets, "."), arcSchema))
	if err != nil {
		s.internal(w, err)
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	out := api.ArcKit{Season: apiSeason(s.g).N, Templates: []string{}, When: slices.Sorted(maps.Keys(arc.Predicates)),
		Effects: sheets.StoryEffectKinds(), Schema: string(schema), Taken: slices.Sorted(maps.Keys(s.g.Rules().Book.StoryIDs()))}
	for _, a := range s.g.Rules().Book.Arcs {
		out.Templates = append(out.Templates, a.ID)
	}
	reply(w, http.StatusOK, out)
}
