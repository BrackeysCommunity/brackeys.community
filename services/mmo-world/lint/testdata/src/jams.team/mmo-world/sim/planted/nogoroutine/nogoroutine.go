package nogoroutine

func goroutines(c chan int) { // want `channel in sim/`
	go func() {}() // want `go statement in sim/`
	select {       // want `select in sim/`
	case <-c:
	}
}
