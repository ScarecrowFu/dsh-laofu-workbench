package main

import (
	"strings"
	"testing"
)

// deep builds a Windows path of exactly `length` characters.
func deep(length int) string {
	base := `C:\Users\alanfu\AppData\Local\LaofuWorkbench\program\win32-x64\stable\0.1.9-abcdef0123456789\`
	return base + strings.Repeat("a", length-len(base))
}

func TestShortPathsAreLeftExactlyAsGiven(t *testing.T) {
	// The ordinary case must not change: an extended path skips normalisation,
	// so prefixing a path that did not need it would be a gratuitous difference
	// between what the launcher writes and what everything else expects.
	for _, path := range []string{
		`C:\Users\alanfu\AppData\Local\LaofuWorkbench\program\win32-x64\stable\0.1.9-abc\app.exe`,
		`C:/mixed/slashes/stay/short`,
		`relative\path`,
		``,
	} {
		if got := extendedPath(path, true); got != path {
			t.Fatalf("short path %q became %q", path, got)
		}
	}
}

func TestLongWindowsPathsAreExtended(t *testing.T) {
	path := deep(legacyPathLimit)
	if got, want := extendedPath(path, true), `\\?\`+path; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	// One character under the threshold is still a legacy path.
	if got := extendedPath(deep(legacyPathLimit-1), true); got != deep(legacyPathLimit-1) {
		t.Fatalf("a path below the threshold was extended: %q", got)
	}
}

func TestOtherHostsKeepTheirPaths(t *testing.T) {
	path := deep(legacyPathLimit + 40)
	if got := extendedPath(path, false); got != path {
		t.Fatalf("a non-Windows host changed the path: %q", got)
	}
	// macOS paths are longer than Windows' limit all the time and need nothing.
	if got := extendedPath("/Users/alanfu/"+strings.Repeat("d/", 200)+"x", false); got == "" {
		t.Fatal("empty result")
	}
}

func TestPathsWindowsCannotExtendAreUntouched(t *testing.T) {
	cases := map[string]string{
		"already extended": `\\?\C:\` + strings.Repeat("a", legacyPathLimit+20),
		"device path":      `\\.\pipe\` + strings.Repeat("a", legacyPathLimit+20),
		"forward slashes":  `C:/` + strings.Repeat("a", legacyPathLimit+20),
		"relative":         strings.Repeat("a", legacyPathLimit+20),
		"drive relative":   `C:` + strings.Repeat("a", legacyPathLimit+20),
	}
	for name, path := range cases {
		if got := extendedPath(path, true); got != path {
			t.Fatalf("%s was rewritten to %q", name, got)
		}
	}
}

func TestNetworkSharesUseTheUncForm(t *testing.T) {
	path := `\\build-host\artifacts\` + strings.Repeat("a", legacyPathLimit)
	want := `\\?\UNC\build-host\artifacts\` + strings.Repeat("a", legacyPathLimit)
	if got := extendedPath(path, true); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
