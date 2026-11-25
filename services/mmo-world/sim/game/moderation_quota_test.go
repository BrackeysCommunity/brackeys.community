package game

import (
	"strconv"
	"testing"
)

// TestReportQuotaCountsJoins: joining cases opened on an earlier day
// counts toward the day's reports, so the join past reports-per-day is
// refused.
func TestReportQuotaCountsJoins(t *testing.T) {
	g, _, d, _, _ := modGame(t)
	most := g.lp("reports-per-day")
	var refs []string
	for i := range most + 1 {
		x := modAct(t, g, Command{Key: "qx" + strconv.FormatInt(i, decimal), Kind: Create, Server: "a"}).Char
		ref := RefCharacter + ":" + x.C.ID
		modAct(t, g, Command{Key: "qo" + strconv.FormatInt(i, decimal), Char: x.C.ID, Kind: ReportCase, Server: "a",
			Case: &CaseCmd{Ref: ref, Reason: "name"}})
		refs = append(refs, ref)
	}
	for day := g.World.Day; g.World.Day == day; {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	join := func(i int64) Command {
		return Command{Key: "qj" + strconv.FormatInt(i, decimal), Char: d.C.ID, Kind: ReportCase, Server: "a",
			Case: &CaseCmd{Ref: refs[i], Reason: "name"}}
	}
	for i := range most {
		modAct(t, g, join(i))
	}
	modRefused(t, g, join(most), CaseLimit)
}

// TestExcludedFromStagedVault: a character excluded in server a's house
// may not arm a's staged vault, and the refusal changes nothing.
func TestExcludedFromStagedVault(t *testing.T) {
	g, stager, st := vaultWorld(t)
	other := vaultParty(t, g, st.At, 1)[0]
	modAct(t, g, modCmd(stager, "qx-exclude", ModExclude, RefCharacter+":"+other.C.ID, 0, ""))
	vaultRefused(t, g, other, Excluded, armVault)
	targeted := armVault
	targeted.Target = st.ID
	vaultRefused(t, g, other, Excluded, targeted)
}
