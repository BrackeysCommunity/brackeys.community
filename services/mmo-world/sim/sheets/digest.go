package sheets

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// Digest names a book, so a world knows which sheets it runs on.
func (b *Book) Digest() (string, error) {
	j, err := json.Marshal(b)
	if err != nil {
		return "", err
	}
	s := sha256.Sum256(j)
	return hex.EncodeToString(s[:]), nil
}
