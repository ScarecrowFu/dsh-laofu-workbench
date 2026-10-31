package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Two shapes of release artifact reach this launcher.
//
//	unpacked-zip        an archive of the application directory
//	launch-package-zip  a launcher package: payload/<platform>-<arch>/manifest.json
//	                    beside the archive that manifest describes
//
// The second is what users download and what the update channel serves, so an
// update arrives as a whole package — launcher included — rather than as a bare
// archive. Installing the archive inside it keeps one code path for a first
// launch and for an update, and means the directory a build lands in is named
// after the same checksum either way.
const (
	unpackedType      = "unpacked-zip"
	launchPackageType = "launch-package-zip"

	payloadPrefix    = "payload"
	manifestFileName = "manifest.json"
	// A payload manifest is a dozen short fields; anything near this is not one.
	maxManifestBytes = 64 << 10
)

// stagedTempDir holds the archive unpacked out of a launch package, so the
// caller can remove it once the installation is complete.
var stagedTempDir string

// openLaunchPackage finds the payload manifest inside a launch package and
// unpacks the one archive that manifest names.
//
// Every path here comes from inside a file, so each one is checked before it is
// used: the manifest name must be a bare file name, and the entry it refers to
// must be inside the package's own payload directory.
func openLaunchPackage(archive, tempParent string) (payloadManifest, string, error) {
	var manifest payloadManifest
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return manifest, "", fmt.Errorf("无法读取更新包：%w", err)
	}
	defer reader.Close()

	var prefix string
	for _, entry := range reader.File {
		name := strings.TrimPrefix(filepath.ToSlash(entry.Name), "/")
		// The package may carry more than one payload directory; the first
		// manifest wins, and validateManifest then rejects a wrong platform.
		if path.Base(name) != manifestFileName || path.Dir(path.Dir(name)) != payloadPrefix {
			continue
		}
		raw, err := readZipEntry(entry, maxManifestBytes)
		if err != nil {
			return manifest, "", err
		}
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return manifest, "", fmt.Errorf("更新包里的安装清单不可读：%w", err)
		}
		prefix = path.Dir(name)
		break
	}
	if prefix == "" {
		return manifest, "", fmt.Errorf("更新包里没有安装清单，请重新下载。")
	}
	if !isSafeFileName(manifest.FileName) {
		return manifest, "", fmt.Errorf("更新包里的安装清单无效。")
	}

	wanted := prefix + "/" + manifest.FileName
	for _, entry := range reader.File {
		if strings.TrimPrefix(filepath.ToSlash(entry.Name), "/") != wanted {
			continue
		}
		if entry.UncompressedSize64 > uint64(maxArtifactBytes) {
			return manifest, "", fmt.Errorf("更新包里的应用体积超出限制。")
		}
		directory, err := os.MkdirTemp(tempParent, "payload-")
		if err != nil {
			return manifest, "", err
		}
		stagedTempDir = directory
		target := filepath.Join(directory, manifest.FileName)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return manifest, "", err
		}
		if err := writeEntry(entry, target); err != nil {
			return manifest, "", err
		}
		// The extracted archive is checked against the manifest by installZip,
		// which is the same check a first installation goes through.
		return manifest, target, nil
	}
	return manifest, "", fmt.Errorf("更新包里缺少应用压缩包，请重新下载。")
}

// readZipEntry reads one entry, refusing to buffer more than `limit` bytes.
func readZipEntry(entry *zip.File, limit int64) ([]byte, error) {
	source, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer source.Close()
	raw, err := io.ReadAll(io.LimitReader(source, limit))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) >= limit {
		return nil, fmt.Errorf("更新包里的安装清单过大。")
	}
	return raw, nil
}

// removeStagedTemp discards the archive unpacked out of a launch package.
func removeStagedTemp() {
	if stagedTempDir == "" {
		return
	}
	_ = os.RemoveAll(stagedTempDir)
	stagedTempDir = ""
}
