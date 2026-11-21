package service

import "jams.team/mmo-world/sim/game"

// Game is the held game, for a test that sets a scene no command reaches.
func (s *Server) Game() *game.Game { return s.g }
