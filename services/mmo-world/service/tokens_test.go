package service_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"slices"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/store/pgtest"
)

// TestTokenLists runs a world with each token setting rotating, "new,old":
// either token opens its paths, and anything else, the list itself
// included, is refused.
func TestTokenLists(t *testing.T) {
	r := startOn(t, pgtest.Pool(t), io.Discard, func(c *service.Config) {
		c.APIToken, c.OperatorToken, c.MapToken = "api-new, api-old", "op-new,"+opToken, "map-new,map-old"
	})
	status := func(path, token string) int {
		t.Helper()
		resp, err := r.http.Client().Do(authed(t, http.MethodGet, r.http.URL+path, token))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	for _, c := range []struct {
		path, token string
		open        bool
	}{
		{api.PathLexicon, "api-new", true}, {api.PathLexicon, "api-old", true}, {api.PathLexicon, "", false},
		{api.PathLexicon, "api-new, api-old", false}, {api.PathLexicon, "api", false}, {api.PathLexicon, "op-new", false},
		{api.PathOperatorDigest, "op-new", true}, {api.PathOperatorDigest, opToken, true}, {api.PathOperatorDigest, "api-new", false},
		{api.PathMapIndex, "map-new", true}, {api.PathMapIndex, "map-old", true}, {api.PathMapIndex, "api-old", true},
		{api.PathMapIndex, "op-new", false}, {api.PathMapIndex, "", false},
	} {
		got := status(c.path, c.token)
		if c.open == (got == http.StatusUnauthorized) {
			t.Errorf("%s with %q answered %d", c.path, c.token, got)
		}
	}
}

// TestOperatorPathsClosed keeps the operator paths shut when the operator
// setting lists no token.
func TestOperatorPathsClosed(t *testing.T) {
	r := startOn(t, pgtest.Pool(t), io.Discard, func(c *service.Config) { c.OperatorToken = " , " })
	resp, err := r.http.Client().Do(authed(t, http.MethodGet, r.http.URL+api.PathOperatorDigest, ""))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("an empty operator list answered %d", resp.StatusCode)
	}
}

func TestTokens(t *testing.T) {
	var got []string
	for _, b := range service.Tokens(" new , old,,") {
		got = append(got, string(b))
	}
	if !slices.Equal(got, []string{"new", "old"}) || service.Tokens("") != nil {
		t.Fatalf("tokens %q", got)
	}
	t.Setenv(service.EnvOperatorToken, "new,old")
	if got := service.TokenFromEnv(service.EnvOperatorToken); got != "new" {
		t.Fatalf("a client sends %q while rotating", got)
	}
}

// TestNextRollFromEnv derives the next roll key at start, before the
// master is cleared, and guards its every text form with the others.
func TestNextRollFromEnv(t *testing.T) {
	m := sha256.Sum256([]byte("mmo/env-master"))
	set := func(next string) {
		t.Setenv(service.EnvMaster, base64.StdEncoding.EncodeToString(m[:]))
		t.Setenv(service.EnvWorld, world)
		t.Setenv(service.EnvEpoch, "0")
		t.Setenv(service.EnvEpochNext, next)
	}
	set("")
	plain, err := service.SecretsFromEnv()
	if err != nil || plain.NextEpoch != nil {
		t.Fatalf("no next roll epoch set: %+v %v", plain.NextEpoch, err)
	}
	set("1")
	sec, err := service.SecretsFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv(service.EnvMaster) != "" {
		t.Fatal("the master is still in the environment")
	}
	want, err := keys.Derive(m[:], world, 1)
	if err != nil {
		t.Fatal(err)
	}
	if sec.NextEpoch == nil || *sec.NextEpoch != 1 || sec.NextKeys != want || sec.Keys != plain.Keys {
		t.Fatalf("next roll epoch %v, keys match %v", sec.NextEpoch, sec.NextKeys == want)
	}
	if want.Generation != sec.Keys.Generation || want.Quirk != sec.Keys.Quirk {
		t.Fatal("the next roll epoch moved the generation or quirk key")
	}
	if !slices.Contains(sec.Needles, hex.EncodeToString(want.Roll[:])) || !slices.Contains(sec.Needles, base64.StdEncoding.EncodeToString(want.Roll[:])) {
		t.Fatal("the next roll key is not among the needles")
	}
	if !slices.Equal(sec.Needles[:len(plain.Needles)], plain.Needles) || len(sec.Needles) == len(plain.Needles) {
		t.Fatal("the next roll key's needles do not follow the others")
	}
	for _, n := range sec.Needles[len(plain.Needles):] {
		if slices.Contains(plain.Needles, n) {
			t.Fatal("a needle is listed twice")
		}
	}
	set("x")
	if _, err := service.SecretsFromEnv(); err == nil {
		t.Fatal("a roll epoch that is no number was taken")
	}
}
