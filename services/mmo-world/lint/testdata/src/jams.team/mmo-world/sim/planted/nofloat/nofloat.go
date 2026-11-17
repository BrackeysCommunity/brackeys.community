package nofloat

func floats() {
	var x float64 = 1.5 // want `float type in sim/` `float literal in sim/`
	_ = x               // want `float type in sim/`
}
