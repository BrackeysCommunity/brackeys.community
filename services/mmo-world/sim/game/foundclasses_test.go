package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
)

// router is a character at Router's thresholds, short of one practice
// level of circuit when short is set.
func router(t *testing.T, g *Game, key string, short bool) *Char {
	t.Helper()
	c := mustCreate(t, g, key, "knife")
	row := g.classRow("router")
	if row == nil || !row.Hidden {
		t.Fatal("the sheets hide no router")
	}
	for _, q := range row.Unlock {
		at := q.At
		if short && q.ID == "circuit" {
			at--
		}
		c.C.Practice = append(c.C.Practice, char.Skill{ID: q.ID, Level: at})
	}
	return c
}

// The first to cross a hidden class finds it for everyone: the class is
// earned as any is, a class promotion names the crosser with its unlock as
// the cause, and the row is shown from then on. A second crosser finds
// nothing new.
func TestFoundClassFirst(t *testing.T) {
	g := feedGame(t)
	c := router(t, g, "router-1", false)
	if err := g.classesFor(c, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if !c.C.Classes.Has("router") || !slices.Equal(g.FoundClasses, []string{"router"}) || !g.ClassShown("router") {
		t.Fatalf("router earned %v, found %v", c.C.Classes.Has("router"), g.FoundClasses)
	}
	ps := promotionsOf(g, emerge.Class)
	if len(ps) != 1 || ps[0].Of != "router" || ps[0].First != c.C.ID {
		t.Fatalf("the class promotions are %+v", ps)
	}
	f, _ := g.Log.Get(ps[0].Fact)
	cause, ok := g.Log.Get(f.Causes[0])
	if !ok || cause.Kind != "class.unlocked" || cause.Subjects[0] != char.Ref(c.C.ID) {
		t.Fatalf("the class promotion cites %+v", cause)
	}
	name := g.r.Name("classes.classes:router")
	if name == "" {
		name = "router"
	}
	if ps[0].Name != name {
		t.Fatalf("the class promotion is named %q, want %q", ps[0].Name, name)
	}
	second := router(t, g, "router-2", false)
	if err := g.classesFor(second, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if !second.C.Classes.Has("router") || len(promotionsOf(g, emerge.Class)) != 1 || len(g.FoundClasses) != 1 {
		t.Fatal("a second crosser found the class again")
	}
}

// A hidden class nobody has crossed stays unseen, one threshold short
// finds nothing, and a world without emergence earns it without finding it.
func TestHiddenClassUnseen(t *testing.T) {
	g := feedGame(t)
	for _, row := range g.r.Book.Classes {
		if g.ClassShown(row.ID) == row.Hidden {
			t.Fatalf("class %s shown %v, hidden %v", row.ID, g.ClassShown(row.ID), row.Hidden)
		}
	}
	if g.ClassShown("no-such") {
		t.Fatal("an unknown class is shown")
	}
	short := router(t, g, "router-short", true)
	if err := g.classesFor(short, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if short.C.Classes.Has("router") || len(g.FoundClasses) != 0 || g.ClassShown("router") {
		t.Fatal("a character a level short crossed router")
	}

	g.Emergence = nil
	g.wireEmergence()
	off := router(t, g, "router-off", false)
	if err := g.classesFor(off, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if !off.C.Classes.Has("router") || len(g.FoundClasses) != 0 || g.ClassShown("router") {
		t.Fatal("a world without emergence found a hidden class")
	}
}
