package mapview

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"jams.team/mmo-world/api"
)

// revLen is how many hex characters of the hash a rev keeps: 64 bits, so
// two payloads of one world never share a URL.
const revLen = 16

// Rev is a payload's rev: the first 16 hex of the sha256 of its JSON with
// Rev itself empty.
func Rev(v any) string {
	switch x := v.(type) {
	case api.MapChunk:
		x.Rev = ""
		v = x
	case *api.MapChunk:
		c := *x
		c.Rev = ""
		v = c
	case api.MapRegions:
		x.Rev = ""
		v = x
	case *api.MapRegions:
		r := *x
		r.Rev = ""
		v = r
	case api.MapStyle:
		x.Rev = ""
		v = x
	case *api.MapStyle:
		s := *x
		s.Rev = ""
		v = s
	}
	body, err := json.Marshal(v)
	if err != nil {
		panic("mapview: a payload that does not marshal: " + err.Error())
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])[:revLen]
}
