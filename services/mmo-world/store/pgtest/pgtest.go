// Package pgtest gives tests a throwaway Postgres database with the mmo
// migrations applied. It uses the server at MMO_TEST_DATABASE_URL when set
// (CI's service container); otherwise it starts a private cluster from
// the server binaries beside the postgres on PATH, in a temporary
// directory, and skips the test when there are none. It never touches a
// shared database.
package pgtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

const envURL = "MMO_TEST_DATABASE_URL"

var (
	once    sync.Once
	server  string // an admin URL
	cluster string // the private cluster's data directory, to stop
	skip    string
)

// Main runs a package's tests and stops a private cluster after them.
func Main(m interface{ Run() int }) {
	code := m.Run()
	if cluster != "" {
		_ = exec.Command(pgCtl(), "-D", cluster, "-m", "immediate", "stop").Run()
		_ = os.RemoveAll(filepath.Dir(cluster))
	}
	os.Exit(code)
}

// Bin is the directory of the postgres server on PATH. initdb and pg_ctl
// are taken from beside it, not from a client-only install, and so are
// the pg_dump and psql a test runs, which must match the server.
func Bin() string {
	p, err := exec.LookPath("postgres")
	if err != nil {
		return ""
	}
	return filepath.Dir(p)
}

func pgCtl() string { return filepath.Join(Bin(), "pg_ctl") }

func start() {
	if u := os.Getenv(envURL); u != "" {
		server = u
		return
	}
	if Bin() == "" {
		skip = "no " + envURL + " and no postgres on PATH"
		return
	}
	initdb := filepath.Join(Bin(), "initdb")
	dir, err := os.MkdirTemp("", "mmo-pg")
	if err != nil {
		skip = err.Error()
		return
	}
	data := filepath.Join(dir, "data")
	env := append(os.Environ(), "LC_ALL=C")
	cmd := exec.Command(initdb, "-D", data, "-U", "postgres", "-A", "trust")
	cmd.Env = env
	if out, err := cmd.CombinedOutput(); err != nil {
		skip = "initdb: " + string(out)
		return
	}
	port, err := freePort()
	if err != nil {
		skip = err.Error()
		return
	}
	cmd = exec.Command(pgCtl(), "-D", data, "-l", filepath.Join(dir, "log"), "-w",
		"-o", fmt.Sprintf("-p %d -k '' -c listen_addresses=127.0.0.1 -c fsync=off", port), "start")
	cmd.Env = env
	if out, err := cmd.CombinedOutput(); err != nil {
		skip = "pg_ctl start: " + string(out)
		return
	}
	cluster = data
	server = fmt.Sprintf("postgres://postgres@127.0.0.1:%d/postgres?sslmode=disable", port)
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = l.Close() }()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// DB creates a fresh database with the mmo schema and returns its URL.
func DB(t testing.TB) string {
	t.Helper()
	once.Do(start)
	if skip != "" {
		t.Skip("pgtest: " + skip)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	name := "mmo_test_" + hex.EncodeToString(b)
	admin, err := pgx.Connect(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = admin.Close(ctx) }()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(server)
	u.Path = "/" + name
	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	for _, f := range Migrations(t) {
		sql, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
	}
	return u.String()
}

// Server is the admin URL of the server DB makes databases on.
func Server(t testing.TB) string {
	t.Helper()
	once.Do(start)
	if skip != "" {
		t.Skip("pgtest: " + skip)
	}
	return server
}

var schemaLine = regexp.MustCompile(`^\s*-\s*(\S+migration\.sql)\s*$`)

// Migrations are the drizzle migrations sqlc.yaml lists, in order, as
// paths: the same files sqlc reads the schema from.
func Migrations(t testing.TB) []string {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(here), "..", "..")
	raw, err := os.ReadFile(filepath.Join(root, "sqlc.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for line := range strings.SplitSeq(string(raw), "\n") {
		if m := schemaLine.FindStringSubmatch(line); m != nil {
			out = append(out, filepath.Join(root, m[1]))
		}
	}
	return out
}
