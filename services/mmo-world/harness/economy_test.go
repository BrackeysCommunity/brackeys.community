package harness

import (
	"testing"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

func soakBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Digests of `harness economy -n 10` and `harness crime -n 10` on seed "",
// 120 world days, recorded from the code before soak options existed.
const (
	economy10Digest  = "06893af09e0d6010d5b8c14537b2ab0236523824ec53646219d53f06eac808da"
	foundingDigest   = "d30b0395dd995a814b06e6e27c3e5ee633f013ac92cd86165ce3c2663ec0d293"
	crime10Digest    = "06893af09e0d6010d5b8c14537b2ab0236523824ec53646219d53f06eac808da"
	recordedSoakDays = 120
)

func economyEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{"ECONOMY_SEED", "ECONOMY_GUILDS", "ECONOMY_DAYS", "ECONOMY_ONLY", "ECONOMY_STAGING"} {
		t.Setenv(k, "")
	}
}

// TestSoakZeroOptions: with every option off, the Economy and Crime soaks
// at ten players give their recorded digests, and so does soakWith.
func TestSoakZeroOptions(t *testing.T) {
	economyEnv(t)
	b := soakBook(t)
	r, err := soak(b, soakers(b, 10), recordedSoakDays)
	if err != nil {
		t.Fatal(err)
	}
	if r.digest != economy10Digest {
		t.Errorf("economy at 10: digest %s, recorded %s", r.digest, economy10Digest)
	}
	fr, err := soak(b, founders(b), foundersDays)
	if err != nil {
		t.Fatal(err)
	}
	if fr.digest != foundingDigest {
		t.Errorf("the founding world: digest %s, recorded %s", fr.digest, foundingDigest)
	}
	cr, err := soakCrime(b, 10, recordedSoakDays, true)
	if err != nil {
		t.Fatal(err)
	}
	if cr.digest != crime10Digest {
		t.Errorf("crime at 10: digest %s, recorded %s", cr.digest, crime10Digest)
	}
	sr, err := soakWith(b, 10, recordedSoakDays, soakOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if sr.digest != economy10Digest {
		t.Errorf("soakWith, no options: digest %s, recorded %s", sr.digest, economy10Digest)
	}
	if !sr.clean() || len(sr.read.cost) != recordedSoakDays || sr.crime != nil || sr.staging != nil {
		t.Errorf("no options: clean %v, %d days timed, crime %v, staging %v", sr.clean(), len(sr.read.cost), sr.crime != nil, sr.staging != nil)
	}
}

// structural: the option soaks' size and days.
const (
	optionPlayers = 10
	optionDays    = 5
)

// TestSoakOptions: each option, alone in a ten-player five-day soak,
// turns on what it names and moves the world off the plain soak's.
func TestSoakOptions(t *testing.T) {
	economyEnv(t)
	b := soakBook(t)
	plain, err := soakWith(b, optionPlayers, optionDays, soakOptions{})
	if err != nil {
		t.Fatal(err)
	}
	run := func(t *testing.T, o soakOptions) *soakResult {
		t.Helper()
		r, err := soakWith(b, optionPlayers, optionDays, o)
		if err != nil {
			t.Fatal(err)
		}
		if !r.clean() {
			t.Fatalf("%s: audit %v, daily %v", o, r.audit, r.read.audits)
		}
		return r
	}
	t.Run("thieves", func(t *testing.T) {
		r := run(t, soakOptions{Thieves: true})
		var thieves []*agent.Player
		for _, p := range r.crime.players {
			if _, ok := p.Policy.(*agent.Thief); ok {
				thieves = append(thieves, p)
			}
		}
		if len(thieves) != optionPlayers/stealEvery || r.crime.slice == nil {
			t.Fatalf("%d thieves among %d players; the watch opened %v", len(thieves), optionPlayers, r.crime.slice != nil)
		}
	})
	t.Run("staging", func(t *testing.T) {
		r := run(t, soakOptions{Staging: true})
		if r.staging == nil || r.staging.leaks != 0 || r.staging.dayN != optionDays {
			t.Fatalf("staging watch %+v", r.staging)
		}
		if r.digest == plain.digest {
			t.Fatal("the stagers joined and the world did not move")
		}
	})
	t.Run("season", func(t *testing.T) {
		r := run(t, soakOptions{Season: true})
		if len(r.read.seasons) != optionDays || r.read.seasons[0].season != 0 || r.read.seasons[optionDays-1].of != optionDays+1 {
			t.Fatalf("season marks %+v", r.read.seasons)
		}
		if r.digest != plain.digest {
			t.Fatal("reading the clock of a world that keeps one moved it")
		}
	})
	t.Run("emergence", func(t *testing.T) {
		r := run(t, soakOptions{Emergence: true})
		if len(r.read.emerge) != optionDays || r.read.emerge[optionDays-1].spots == 0 {
			t.Fatalf("emergence marks %+v", r.read.emerge)
		}
	})
	t.Run("empty server", func(t *testing.T) {
		r := run(t, soakOptions{EmptyServer: true})
		if !r.read.house || len(r.read.empty.places) != 1 {
			t.Fatalf("the empty server: house %v, places %+v", r.read.house, r.read.empty.places)
		}
		if r.digest == plain.digest {
			t.Fatal("the empty server joined and the world did not move")
		}
	})
	t.Run("adversary", func(t *testing.T) {
		var m agentMix
		for i := range m {
			m[i] = 1
		}
		r := run(t, soakOptions{Adversary: m})
		if r.read.loop.players != optionPlayers/stealEvery || r.read.loop.charDays == 0 || r.read.others.players == 0 {
			t.Fatalf("the mix's reading %+v, the others' %+v", r.read.loop, r.read.others)
		}
		if r.read.loop.played.Sum() == 0 {
			t.Fatal("the mixed player played no activity")
		}
		if r.crime == nil {
			t.Fatal("a mix that steals has no theft audit")
		}
	})
}

// TestStartClocks: a world that keeps no season clock and no traces is
// sent both starts, season first; one from game.New is sent nothing.
func TestStartClocks(t *testing.T) {
	b := soakBook(t)
	w, err := openSoak(b, keys.Throwaway("start-clocks"), soakers(b, optionPlayers))
	if err != nil {
		t.Fatal(err)
	}
	o := soakOptions{Season: true, Emergence: true}
	if sent, err := startClocks(w.g, o); err != nil || len(sent) != 0 {
		t.Fatalf("a new world was sent %v (%v)", sent, err)
	}
	w.g.Story, w.g.Emergence = nil, nil
	sent, err := startClocks(w.g, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(sent) != 2 || sent[0] != game.SeasonStart || w.g.Story == nil || w.g.Emergence == nil {
		t.Fatalf("sent %v; story %v, emergence %v", sent, w.g.Story != nil, w.g.Emergence != nil)
	}
}

// TestSoakReadings: a soak with every system on reads every target the
// soak names, each holding, and the adversary's reading counts its
// players' worth.
func TestSoakReadings(t *testing.T) {
	economyEnv(t)
	b := soakBook(t)
	var m agentMix
	for i := range m {
		m[i] = 1
	}
	o := soakOptions{Thieves: true, Staging: true, Emergence: true, Season: true, EmptyServer: true, Adversary: m}
	r, err := soakWith(b, optionPlayers, stagingFrom+2, o)
	if err != nil {
		t.Fatal(err)
	}
	if v := r.band(b); !v.drifts || len(r.days) != stagingFrom+2 {
		t.Fatalf("a ten-player soak read %+v over %d days", v, len(r.days))
	}
	if r.staging.minted == 0 {
		t.Fatal("the staging adversary staged nothing by its second day")
	}
	if r.read.loop.players == 0 || r.read.loop.perDay() != r.read.loop.gained/r.read.loop.charDays {
		t.Fatalf("the mix's reading %+v", r.read.loop)
	}
	got := map[string]Measured{}
	for _, x := range soakReadings(b, []*soakResult{r}) {
		got[x.Target] = x
	}
	for _, id := range []string{"coin-drift", "thieves-hold-band", "theft-never-mints", "staged-goods-local", "guild-works-sink", "spoils-conserved"} {
		x, ok := got[id]
		if !ok {
			t.Errorf("no reading for %s", id)
			continue
		}
		if id != "coin-drift" && id != "thieves-hold-band" && !x.Holds {
			t.Errorf("%s misses: %s", id, x.Value)
		}
	}
	if _, ok := got["coin-band"]; ok {
		t.Error("ten players read the band rather than drift")
	}
}
