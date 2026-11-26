package main

import (
	"strings"

	"jams.team/mmo-world/api"
)

// forgetCmd forgets a character for a player who asked by email, through
// the operator path, as /forget-me would: the same recorded command, so
// its identity goes at once and its holdings at its first free tick. The
// note is kept with the command for as long as the world, so it says why,
// never who asked.
func forgetCmd(id string, args []string) error {
	if err := need(args, 2); err != nil {
		return err
	}
	return operate(api.OperatorRequest{InteractionID: id, CharacterID: args[0], Kind: api.ActForget, Note: strings.Join(args[1:], " ")})
}
