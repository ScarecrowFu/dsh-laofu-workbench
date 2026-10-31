package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeLaunchPackage writes the artifact a release publishes: a launcher, a
// payload manifest and the archive that manifest describes, all in one zip.
func makeLaunchPackage(t *testing.T, manifest payloadManifest, inner []byte) (string, string, int64) {
	t.Helper()
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return makeArchive(t, map[string]string{
		"Laofu Workbench.exe":             "launcher bytes",
		"payload/win32-x64/app.zip":       string(inner),
		"payload/win32-x64/manifest.json": string(raw),
	})
}

// stage writes the launch package and the record the workbench would leave
// beside it, and points the launcher at that directory.
func stage(t *testing.T, pkg string, sum string, size int64, version string) string {
	t.Helper()
	directory := t.TempDir()
	body, err := os.ReadFile(pkg)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "release.zip"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	record, err := json.Marshal(stagedRecord{
		SchemaVersion: 1,
		Version:       version,
		FileName:      "release.zip",
		Sha256:        sum,
		SizeBytes:     number(size),
		ArtifactType:  launchPackageType,
		PreparedAt:    "2026-10-31T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "staged.json"), record, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LWB_STAGED_DIR", directory)
	t.Setenv("LWB_PRODUCT", productSlug)
	return directory
}

func TestStagedLaunchPackageInstallsTheArchiveInsideIt(t *testing.T) {
	defer removeStagedTemp()
	inner, innerSum, innerSize := makeArchive(t, map[string]string{
		"win-unpacked/Laofu Workbench.exe": "application bytes",
		"win-unpacked/resources/app.asar":  "payload",
	})
	innerBytes, err := os.ReadFile(inner)
	if err != nil {
		t.Fatal(err)
	}
	carried := payloadManifest{
		SchemaVersion: 1,
		Product:       productSlug,
		ProductName:   "Laofu Workbench",
		Version:       "0.1.10",
		Platform:      "win32",
		Arch:          "x64",
		Channel:       "stable",
		ArtifactType:  unpackedType,
		FileName:      "app.zip",
		Sha256:        innerSum,
		SizeBytes:     number(innerSize),
	}
	pkg, pkgSum, pkgSize := makeLaunchPackage(t, carried, innerBytes)
	stage(t, pkg, pkgSum, pkgSize, "0.1.10")

	manifest, archive, err := stagedInstallation(t.TempDir())
	if err != nil {
		t.Fatalf("a launch package should install the archive inside it: %v", err)
	}
	// The manifest that comes back describes the *build*, so the directory it is
	// installed into is named after the same checksum a first install would use.
	if manifest.Sha256 != innerSum || int64(manifest.SizeBytes) != innerSize {
		t.Fatalf("expected the payload manifest, got sha %s size %d", manifest.Sha256, manifest.SizeBytes)
	}
	if manifest.ArtifactType != unpackedType || manifest.FileName != "app.zip" {
		t.Fatalf("unexpected install shape: %+v", manifest)
	}
	if hash(t, archive) != innerSum {
		t.Fatal("the extracted archive does not match the checksum the manifest claims")
	}
}

func TestStagedLaunchPackageRefusesATamperedContainer(t *testing.T) {
	defer removeStagedTemp()
	inner, innerSum, innerSize := makeArchive(t, map[string]string{"App.exe": "bytes"})
	innerBytes, err := os.ReadFile(inner)
	if err != nil {
		t.Fatal(err)
	}
	carried := payloadManifest{
		SchemaVersion: 1, Product: productSlug, Version: "0.1.10", Platform: "win32",
		Arch: "x64", Channel: "stable", ArtifactType: unpackedType, FileName: "app.zip",
		Sha256: innerSum, SizeBytes: number(innerSize),
	}
	pkg, pkgSum, pkgSize := makeLaunchPackage(t, carried, innerBytes)
	directory := stage(t, pkg, pkgSum, pkgSize, "0.1.10")
	// One byte changed after the workbench recorded the checksum is the case the
	// launcher exists to catch: the app is already gone, nothing else will look.
	body, err := os.ReadFile(filepath.Join(directory, "release.zip"))
	if err != nil {
		t.Fatal(err)
	}
	body[len(body)/2] ^= 0xff
	if err := os.WriteFile(filepath.Join(directory, "release.zip"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := stagedInstallation(t.TempDir()); err == nil {
		t.Fatal("a package that no longer matches its staged checksum must be refused")
	}
}

func TestStagedLaunchPackageRefusesAManifestThatNamesAPath(t *testing.T) {
	defer removeStagedTemp()
	inner, innerSum, innerSize := makeArchive(t, map[string]string{"App.exe": "bytes"})
	innerBytes, err := os.ReadFile(inner)
	if err != nil {
		t.Fatal(err)
	}
	carried := payloadManifest{
		SchemaVersion: 1, Product: productSlug, Version: "0.1.10", Platform: "win32",
		Arch: "x64", Channel: "stable", ArtifactType: unpackedType,
		FileName: "../../evil.zip", Sha256: innerSum, SizeBytes: number(innerSize),
	}
	pkg, pkgSum, pkgSize := makeLaunchPackage(t, carried, innerBytes)
	stage(t, pkg, pkgSum, pkgSize, "0.1.10")
	if _, _, err := stagedInstallation(t.TempDir()); err == nil {
		t.Fatal("a manifest naming a path outside the payload directory must be refused")
	}
}

func TestStagedLaunchPackageRefusesAnotherVersion(t *testing.T) {
	defer removeStagedTemp()
	inner, innerSum, innerSize := makeArchive(t, map[string]string{"App.exe": "bytes"})
	innerBytes, err := os.ReadFile(inner)
	if err != nil {
		t.Fatal(err)
	}
	carried := payloadManifest{
		SchemaVersion: 1, Product: productSlug, Version: "0.1.9", Platform: "win32",
		Arch: "x64", Channel: "stable", ArtifactType: unpackedType, FileName: "app.zip",
		Sha256: innerSum, SizeBytes: number(innerSize),
	}
	pkg, pkgSum, pkgSize := makeLaunchPackage(t, carried, innerBytes)
	// The release offered 0.1.10 but the package carries 0.1.9: installing it
	// would silently move the user backwards.
	stage(t, pkg, pkgSum, pkgSize, "0.1.10")
	if _, _, err := stagedInstallation(t.TempDir()); err == nil {
		t.Fatal("a package of another version must be refused")
	}
}

func TestStagedPackageWithoutAManifestIsRefused(t *testing.T) {
	defer removeStagedTemp()
	pkg, pkgSum, pkgSize := makeArchive(t, map[string]string{
		"Laofu Workbench.exe":       "launcher bytes",
		"payload/win32-x64/app.zip": "not a manifest",
	})
	stage(t, pkg, pkgSum, pkgSize, "0.1.10")
	if _, _, err := stagedInstallation(t.TempDir()); err == nil {
		t.Fatal("a package without a payload manifest must be refused")
	}
}

func TestBootstrapReadsThePackageLayoutTheBuildProduces(t *testing.T) {
	// The launcher and the packaging script agree on exactly one layout:
	// payload/<platform>-<arch>/{manifest.json, <fileName>} beside the launcher.
	// Nothing else connects the two, so the layout is pinned here.
	launcherDirectory := t.TempDir()
	payload := filepath.Join(launcherDirectory, "payload", "win32-x64")
	if err := os.MkdirAll(payload, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := payloadManifest{
		SchemaVersion: 1, Product: productSlug, ProductName: "Laofu Workbench",
		Version: "0.1.9", Platform: "win32", Arch: "x64", Channel: "stable",
		ArtifactType: unpackedType, FileName: "app.zip",
		Sha256: strings.Repeat("a", 64), SizeBytes: 1024,
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(payload, "manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	read, archive, err := bootstrapInstallation(launcherDirectory, "win32", "x64")
	if err != nil {
		t.Fatalf("the launcher must find the manifest the build writes: %v", err)
	}
	if read.Version != "0.1.9" || read.FileName != "app.zip" {
		t.Fatalf("unexpected manifest: %+v", read)
	}
	if archive != filepath.Join(payload, "app.zip") {
		t.Fatalf("the archive must be read from beside the manifest, got %s", archive)
	}

	// Another architecture's package is not this launcher's, and a missing one
	// is a message the user can act on rather than an empty start.
	if _, _, err := bootstrapInstallation(launcherDirectory, "win32", "arm64"); err == nil {
		t.Fatal("a package for another architecture must not be found")
	}
}

func TestStagedUnpackedArchiveStillInstalls(t *testing.T) {
	defer removeStagedTemp()
	archive, sum, size := makeArchive(t, map[string]string{"win-unpacked/App.exe": "bytes"})
	directory := t.TempDir()
	body, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "app.zip"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	record, err := json.Marshal(stagedRecord{
		SchemaVersion: 1, Version: "0.1.10", FileName: "app.zip",
		Sha256: sum, SizeBytes: number(size), ArtifactType: unpackedType,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "staged.json"), record, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LWB_STAGED_DIR", directory)
	t.Setenv("LWB_PRODUCT", productSlug)

	manifest, staged, err := stagedInstallation(t.TempDir())
	if err != nil {
		t.Fatalf("a bare unpacked archive is still installable: %v", err)
	}
	if manifest.ArtifactType != unpackedType || manifest.Version != "0.1.10" {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
	if hash(t, staged) != sum {
		t.Fatal("the staged archive was not handed over unchanged")
	}
}
