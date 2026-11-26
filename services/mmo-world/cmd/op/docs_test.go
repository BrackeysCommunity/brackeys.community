package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The operator docs name only what exists, so a renamed command, setting
// or path fails here instead of in an incident.

const (
	moduleRoot = "../.."
	botRoot    = "../../../mmo-bot"
	repoRoot   = "../../../.."
)

var (
	codeSpan    = regexp.MustCompile("(?s)```.*?```|`[^`]+`")
	opWord      = regexp.MustCompile("(?:^|[\\s`(|;&]|cmd/)op\\s+(?:-id\\s+\\S+\\s+)?([a-z][a-z-]*)")
	usageWord   = regexp.MustCompile(`(?m)(?:^  |\|  )([a-z][a-z-]*)`)
	envName     = regexp.MustCompile(`\bMMO_[A-Z0-9_]*[A-Z0-9]`)
	goEnvName   = regexp.MustCompile(`"(MMO_[A-Z0-9_]*[A-Z0-9])"`)
	envConst    = regexp.MustCompile(`Env\w*\s*=\s*"([A-Z][A-Z0-9_]*)"`)
	v1Path      = regexp.MustCompile(`/v1/[a-z0-9/_-]*`)
	apiPath     = regexp.MustCompile(`"(/v1/[^"]*)"`)
	mdLink      = regexp.MustCompile(`\]\(([^)#\s]+)(?:#[^)]*)?\)`)
	urlHost     = regexp.MustCompile(`https?://([^/\s"'<>)]+)`)
	siteHost    = regexp.MustCompile(`(?i)\b(?:brackeys\.(?:community|dev)|jams\.team)\b`)
	localHost   = regexp.MustCompile(`^(?:localhost|127\.0\.0\.1)(?::(?:\d+|\$\w+|\$\{\w+\}))?$`)
	placeholder = regexp.MustCompile(`^<[^>]*>$`)
)

// docs are the README and every page under docs/, by path.
func docs(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	read := func(path string) {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		out[path] = string(b)
	}
	read(filepath.Join(moduleRoot, "README.md"))
	err := filepath.WalkDir(filepath.Join(moduleRoot, "docs"), func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".md") {
			read(path)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) < 2 {
		t.Fatalf("found %d docs, want the README and docs/", len(out))
	}
	return out
}

func files(t *testing.T, pattern string) []string {
	t.Helper()
	got, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func text(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// goSources is every Go file of the module but its tests.
func goSources(t *testing.T) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(moduleRoot, func(path string, d fs.DirEntry, err error) error {
		switch {
		case err != nil:
			return err
		case d.IsDir() && (d.Name() == "testdata" || d.Name() == "node_modules"):
			return filepath.SkipDir
		case !d.IsDir() && strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, "_test.go"):
			out = append(out, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestDocsNameOnlyOpCommands(t *testing.T) {
	commands := map[string]bool{}
	for _, m := range usageWord.FindAllStringSubmatch(usage, -1) {
		commands[m[1]] = true
	}
	if !commands["forget"] || !commands["verify"] {
		t.Fatalf("read %d commands from op's usage, which misses forget or verify", len(commands))
	}
	named := 0
	for path, doc := range docs(t) {
		for _, span := range codeSpan.FindAllString(doc, -1) {
			for _, m := range opWord.FindAllStringSubmatch(span, -1) {
				named++
				if !commands[m[1]] {
					t.Errorf("%s names `op %s`, which op's usage does not list", path, m[1])
				}
			}
		}
	}
	if named == 0 {
		t.Fatal("no doc names an op command")
	}
}

func TestDocsNameOnlyEnvThatExists(t *testing.T) {
	known := map[string]bool{}
	for _, path := range goSources(t) {
		for _, m := range goEnvName.FindAllStringSubmatch(text(t, path), -1) {
			known[m[1]] = true
		}
	}
	others := slices.Concat(files(t, filepath.Join(moduleRoot, "scripts", "*.sh")), files(t, filepath.Join(botRoot, "scripts", "*.sh")),
		[]string{filepath.Join(botRoot, "src", "config.ts"), filepath.Join(repoRoot, "src", "env.ts")})
	for _, path := range others {
		for _, name := range envName.FindAllString(text(t, path), -1) {
			known[name] = true
		}
	}
	for path, doc := range docs(t) {
		for _, name := range envName.FindAllString(doc, -1) {
			if !known[name] {
				t.Errorf("%s names %s, which no service, script or env file reads", path, name)
			}
		}
	}
}

func TestDocsReadmeListsEverySetting(t *testing.T) {
	readme := text(t, filepath.Join(moduleRoot, "README.md"))
	for _, path := range []string{filepath.Join(moduleRoot, "service", "env.go"), filepath.Join(moduleRoot, "gateway", "env.go")} {
		names := envConst.FindAllStringSubmatch(text(t, path), -1)
		if len(names) == 0 {
			t.Fatalf("%s declares no settings", path)
		}
		for _, m := range names {
			if !strings.Contains(readme, "`"+m[1]+"`") {
				t.Errorf("the README's environment table misses %s (%s)", m[1], path)
			}
		}
	}
}

func TestDocsNameOnlyAPIPaths(t *testing.T) {
	var paths []string
	for _, path := range files(t, filepath.Join(moduleRoot, "api", "*.go")) {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		for _, m := range apiPath.FindAllStringSubmatch(text(t, path), -1) {
			paths = append(paths, m[1])
		}
	}
	served := func(p string) bool {
		return slices.ContainsFunc(paths, func(a string) bool { return a == p || strings.HasSuffix(a, "/") && strings.HasPrefix(p, a) })
	}
	for path, doc := range docs(t) {
		for _, p := range v1Path.FindAllString(doc, -1) {
			if !served(p) {
				t.Errorf("%s names %s, which is not an api path", path, p)
			}
		}
	}
}

func TestDocsLinksAndHosts(t *testing.T) {
	root, err := filepath.Abs(moduleRoot)
	if err != nil {
		t.Fatal(err)
	}
	for path, doc := range docs(t) {
		for _, m := range mdLink.FindAllStringSubmatch(doc, -1) {
			target := m[1]
			if strings.Contains(target, "://") || strings.HasPrefix(target, "mailto:") {
				continue
			}
			abs, err := filepath.Abs(filepath.Join(filepath.Dir(path), target))
			if err != nil {
				t.Fatal(err)
			}
			if rel, err := filepath.Rel(root, abs); err != nil || strings.HasPrefix(rel, "..") {
				continue
			}
			if _, err := os.Stat(abs); err != nil {
				t.Errorf("%s links %s, which does not exist", path, target)
			}
		}
		for _, m := range urlHost.FindAllStringSubmatch(doc, -1) {
			if !localHost.MatchString(m[1]) && !placeholder.MatchString(m[1]) && !strings.HasPrefix(m[1], "$") {
				t.Errorf("%s names the host %s; docs name no host but localhost", path, m[1])
			}
		}
		if siteHost.MatchString(doc) {
			t.Errorf("%s names the site's domain; it comes from SITE", path)
		}
	}
}
