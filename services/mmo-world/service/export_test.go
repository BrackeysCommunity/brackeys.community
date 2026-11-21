package service

import "jams.team/mmo-world/sim/game"

// Game is the held game, for a test that sets a scene no command reaches.
func (s *Server) Game() *game.Game { return s.g }

// Hold takes the world as a tick being saved would, until the returned
// func lets it go.
func (s *Server) Hold() func() {
	s.mu.Lock()
	return s.mu.Unlock
}
