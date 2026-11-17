package exhaustive

type Kind int

const (
	KindA Kind = iota
	KindB
)

func exhaustiveSwitch(k Kind) int {
	switch k { // want `missing cases in expression switch: KindB`
	case KindA:
		return 0
	default:
		return 1
	}
}
