package api

// PartySource reports whether a machine source is a party's: a machine
// whose countdown is its context's and whose log is merged.
func PartySource(source string) bool {
	return source == MachineParty || source == MachineFork || source == MachineGuardian
}
