package canon

import (
	"bytes"
	"encoding/json"
	"io"
)

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

func numbersToInts(v any) any {
	switch x := v.(type) {
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			panic(err)
		}
		return n
	case []any:
		for i := range x {
			x[i] = numbersToInts(x[i])
		}
	case map[string]any:
		for k := range x {
			x[k] = numbersToInts(x[k])
		}
	}
	return v
}
