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

// PlayerFacts is the reply filter that drops pin and thread facts and
// what the actor may not read.
var PlayerFacts = playerFacts

// VariantSeen is the name and row a fight shows for a region's variant.
var VariantSeen = variantSeen

// ScrubFirsts drops other characters from the FirstKinds facts a reply holds.
var ScrubFirsts = scrubFirsts

// VaultMarks is a machine's vault place and who staged it.
var VaultMarks = vaultMarks
