package sumtype // want package:`sumTypeFact\{Effect \[Add Remove\]\}`

//sumtype:decl
type Effect interface{ effect() }

type Add struct{}
type Remove struct{}

func (Add) effect()    {}
func (Remove) effect() {}

func sealed(e Effect) int {
	switch e.(type) { // want `exhaustiveness check failed for sum type "Effect" \(from .*\): missing cases for Remove`
	case Add:
		return 0
	}
	return 1
}
