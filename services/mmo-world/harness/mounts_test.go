package harness_test

import (
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sheetfs"
)

func TestMountJourneys(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	m, rows, err := harness.MountJourneys(b, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		t.Logf("%+v", r)
	}
	t.Log(m.Value)
	if !m.Holds {
		t.Fatal("mount-shortens does not hold")
	}
}
