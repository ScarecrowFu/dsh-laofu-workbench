package main

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// silent is the progress callback every test uses: progress is presentation, and
// nothing in these tests should depend on it.
func silent(string, string, int) {}

// makeArchive writes a zip whose entries are given as relative paths, the same
// shape the packaging step produces.
func makeArchive(t *testing.T, entries map[string]string) (string, string, int64) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "package.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, body := range entries {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		target, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := target.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return path, hash(t, path), info.Size()
}

func hash(t *testing.T, path string) string {
	t.Helper()
	sum, err := sha256File(path)
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

func manifestFor(t *testing.T, archive string, size int64) payloadManifest {
	t.Helper()
	return payloadManifest{
		SchemaVersion: 1,
		Product:       productSlug,
		Version:       "0.1.10",
		Platform:      "win32",
		Arch:          "x64",
		Channel:       "stable",
		ArtifactType:  "unpacked-zip",
		FileName:      filepath.Base(archive),
		Sha256:        hash(t, archive),
		SizeBytes:     number(size),
	}
}

func TestInstallPlacesBuildInReusableDirectory(t *testing.T) {
	root := t.TempDir()
	archive, _, size := makeArchive(t, map[string]string{
		"win-unpacked/Laofu Workbench.exe": "application bytes",
		"win-unpacked/resources/app.asar":  "payload",
	})
	manifest := manifestFor(t, archive, size)

	first, err := installZip(root, archive, manifest, silent)
	if err != nil {
		t.Fatalf("installZip: %v", err)
	}
	if want := installDirFor(root, manifest); first.directory != want {
		t.Fatalf("installed into %s, want %s", first.directory, want)
	}
	if filepath.Base(first.directory) != "0.1.10-"+shortHash(manifest.Sha256) {
		t.Fatalf("directory %s does not carry version and checksum", first.directory)
	}
	if _, err := os.Stat(first.executable); err != nil {
		t.Fatalf("executable missing: %v", err)
	}

	// A second start must reuse the directory rather than unpack again: the
	// marker file would disappear if the archive were extracted a second time.
	marker := filepath.Join(first.directory, "reuse-marker")
	if err := os.WriteFile(marker, []byte("kept"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := installZip(root, archive, manifest, silent)
	if err != nil {
		t.Fatalf("second installZip: %v", err)
	}
	if second.directory != first.directory {
		t.Fatalf("second start used %s, want %s", second.directory, first.directory)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("second start re-extracted the archive: %v", err)
	}
}

func TestInstallRejectsWrongChecksum(t *testing.T) {
	root := t.TempDir()
	archive, _, size := makeArchive(t, map[string]string{"App.exe": "bytes"})
	manifest := manifestFor(t, archive, size)
	manifest.Sha256 = "0000000000000000000000000000000000000000000000000000000000000000"

	if _, err := installZip(root, archive, manifest, silent); err == nil {
		t.Fatal("installZip accepted an archive whose checksum does not match")
	}
	entries, _ := os.ReadDir(filepath.Join(root, "program"))
	if len(entries) != 0 {
		t.Fatalf("a rejected archive left directories behind: %v", entries)
	}
}

func TestInstallRejectsWrongSize(t *testing.T) {
	root := t.TempDir()
	archive, _, size := makeArchive(t, map[string]string{"App.exe": "bytes"})
	manifest := manifestFor(t, archive, size)
	manifest.SizeBytes = number(size + 1)

	if _, err := installZip(root, archive, manifest, silent); err == nil {
		t.Fatal("installZip accepted an archive whose size does not match the manifest")
	}
}

func TestVerifyInstallationNoticesAChangedExecutable(t *testing.T) {
	root := t.TempDir()
	archive, _, size := makeArchive(t, map[string]string{"App.exe": "original"})
	manifest := manifestFor(t, archive, size)
	current, err := installZip(root, archive, manifest, silent)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := verifyInstallation(current.directory, manifest); !ok {
		t.Fatal("a fresh installation did not verify")
	}
	if err := os.WriteFile(current.executable, []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := verifyInstallation(current.directory, manifest); ok {
		t.Fatal("a modified executable still verified")
	}
	if _, ok := verifyDirectory(current.directory); ok {
		t.Fatal("verifyDirectory accepted a modified executable")
	}
}

func TestFindExecutableNeedsExactlyOneCandidate(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "App.exe"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if found, err := findExecutable(directory); err != nil || filepath.Base(found) != "App.exe" {
		t.Fatalf("findExecutable = %q, %v", found, err)
	}
	if err := os.WriteFile(filepath.Join(directory, "Uninstall.exe"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := findExecutable(directory); err == nil {
		t.Fatal("findExecutable guessed between two executables")
	}
}

func TestFindExecutableLooksInsideWinUnpacked(t *testing.T) {
	directory := t.TempDir()
	nested := filepath.Join(directory, "win-unpacked")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "Laofu Workbench.exe"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	found, err := findExecutable(directory)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(found) != nested {
		t.Fatalf("found %s, want a path inside %s", found, nested)
	}
}

func TestExtractRejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	archive, _, size := makeArchive(t, map[string]string{"../escaped.txt": "no"})
	manifest := manifestFor(t, archive, size)
	if _, err := installZip(root, archive, manifest, silent); err == nil {
		t.Fatal("extraction accepted an entry outside the destination")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "escaped.txt")); err == nil {
		t.Fatal("extraction wrote outside the destination directory")
	}
}

func TestPruneKeepsActiveAndOnePrevious(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "program", "win32-x64", "stable")
	names := []string{"0.1.9-aaaaaaaaaaaaaaaa", "0.1.10-bbbbbbbbbbbbbbbb", "0.1.11-cccccccccccccccc"}
	for index, name := range names {
		directory := filepath.Join(parent, name)
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		// Distinct mtimes make "the one before" unambiguous.
		if err := os.Chtimes(directory, timeAt(index), timeAt(index)); err != nil {
			t.Fatal(err)
		}
	}
	staging := filepath.Join(parent, "0.1.11-dddddddddddddddd.installing-1-2")
	if err := os.MkdirAll(staging, 0o755); err != nil {
		t.Fatal(err)
	}

	pruneInstalled(root, filepath.Join(parent, names[2]))

	remaining, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, entry := range remaining {
		seen[entry.Name()] = true
	}
	if !seen[names[2]] {
		t.Fatal("prune removed the active build")
	}
	if !seen[names[1]] {
		t.Fatal("prune removed the build a rollback needs")
	}
	if seen[names[0]] {
		t.Fatal("prune kept a build older than the rollback target")
	}
	if seen[filepath.Base(staging)] {
		t.Fatal("prune kept an interrupted staging directory")
	}
}

func TestActiveRecordRoundTrip(t *testing.T) {
	root := t.TempDir()
	current := installed{directory: filepath.Join(root, "program", "win32-x64", "stable", "0.1.10-x"), executable: "x"}
	if err := writeActive(root, current, "0.1.10"); err != nil {
		t.Fatal(err)
	}
	record, ok := readActive(root)
	if !ok {
		t.Fatal("active record did not read back")
	}
	if record.Version != "0.1.10" || record.Directory != current.directory {
		t.Fatalf("active record = %+v", record)
	}
}

func TestValidateManifestRejectsForeignPackages(t *testing.T) {
	base := payloadManifest{
		SchemaVersion: 1,
		Product:       productSlug,
		Version:       "0.1.10",
		Platform:      "win32",
		Arch:          "x64",
		Channel:       "stable",
		ArtifactType:  "unpacked-zip",
		FileName:      "package.zip",
		Sha256:        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		SizeBytes:     10,
	}
	if err := validateManifest(base, "win32", "x64"); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	cases := map[string]func(*payloadManifest){
		"other architecture": func(m *payloadManifest) { m.Arch = "arm64" },
		"other artifact":     func(m *payloadManifest) { m.ArtifactType = "portable-exe" },
		"escaping name":      func(m *payloadManifest) { m.FileName = "../package.zip" },
		"missing checksum":   func(m *payloadManifest) { m.Sha256 = "" },
		"oversized":          func(m *payloadManifest) { m.SizeBytes = number(maxArtifactBytes + 1) },
		"missing version":    func(m *payloadManifest) { m.Version = "" },
	}
	for name, mutate := range cases {
		manifest := base
		mutate(&manifest)
		if err := validateManifest(manifest, "win32", "x64"); err == nil {
			t.Fatalf("%s was accepted", name)
		}
	}
}

func TestSizeBytesAcceptsNumberAndString(t *testing.T) {
	for _, raw := range []string{`{"sizeBytes":1234}`, `{"sizeBytes":"1234"}`} {
		var record stagedRecord
		if err := json.Unmarshal([]byte(raw), &record); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if int64(record.SizeBytes) != 1234 {
			t.Fatalf("%s parsed as %d", raw, record.SizeBytes)
		}
	}
}

func timeAt(index int) (parsed time.Time) {
	return time.Unix(int64(1_700_000_000+index*60), 0)
}
