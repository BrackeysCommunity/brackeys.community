// Package pgtest gives each test a fresh database with the mmo migrations,
// on the server at MMO_TEST_DATABASE_URL or else a private cluster from
// the postgres on PATH; with neither, the test skips.
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
	"github.com/jackc/pgx/v5/pgxpool"
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
	port, err := FreePort()
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

// External reports whether tests use a server named in the environment
// rather than a private cluster.
func External() bool { return os.Getenv(envURL) != "" }

// FreePort is a local TCP port nothing listens on now.
func FreePort() (int, error) {
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
	if External() {
		// Cleanups run last first, so the test's pools are closed by now.
		t.Cleanup(func() { drop(t, name) })
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

// drop removes a test's database from a server that outlives the tests.
func drop(t testing.TB, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := pgx.Connect(ctx, server)
	if err != nil {
		t.Error(err)
		return
	}
	defer func() { _ = admin.Close(ctx) }()
	if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
		t.Error(err)
	}
}

// Pool opens a pool on a fresh database, closed when the test ends.
func Pool(t testing.TB) *pgxpool.Pool { return PoolOn(t, DB(t)) }

// PoolOn opens a pool on a database DB made, closed when the test ends.
func PoolOn(t testing.TB, url string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
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
