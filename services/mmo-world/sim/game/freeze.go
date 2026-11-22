package game

// freezeCommand stores the seed's content on every discovered tile of a
// world from before content was drawn from history, and moves it to
// drawing (GDD 4.17). The service sends it once, when it opens such a
// world; it is recorded and replayed like any command, so old ticks
// replay as they ran.
func (g *Game) freezeCommand(Command) error {
	_, err := g.World.Freeze(g.Log)
	return refusedFrom(err)
}
