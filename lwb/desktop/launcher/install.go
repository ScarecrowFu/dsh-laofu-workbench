package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// report receives one progress step: a short stage, a sentence of detail, and
// what share of the whole start is done.
type report func(stage, detail string, percent int)

const (
	receiptName = ".lwb-install.json"
	activeName  = "active.json"
	// Progress is split so every phase moves the bar even when it is the only
	// one that runs: extraction is the long one, starting the app the short one.
	extractStart = 24
	extractEnd   = 82
	// A directory being written is never active, so a failed install is visible
	// as a leftover rather than as a broken version.
	stagingSuffix = ".installing-"
)

// productRoot is where this launcher owns its files. Program files live under
// the local application data directory: they are machine-local, potentially
// large, and must never be pulled into a roaming profile.
func productRoot(localAppData string) string {
	return filepath.Join(localAppData, "LaofuWorkbench")
}

// installDirFor names one installed build. The artifact checksum is part of the
// directory name so that two builds of the same version can never share a
// directory, and so an update is a new directory rather than a rewrite of a
// running one.
func installDirFor(root string, m payloadManifest) string {
	return filepath.Join(root, "program", m.Platform+"-"+m.Arch, m.Channel, m.Version+"-"+shortHash(m.Sha256))
}

func shortHash(sha string) string {
	if len(sha) < 16 {
		return sha
	}
	return sha[:16]
}

// findExecutable locates the one executable a build starts.
//
// The packaging directory is zipped around electron-builder's `win-unpacked`,
// but a differently shaped archive should still work: the app directory root is
// searched first, then `win-unpacked`. Anything other than exactly one candidate
// is an error — guessing here would start the wrong program.
func findExecutable(directory string) (string, error) {
	for _, scope := range []string{directory, filepath.Join(directory, "win-unpacked")} {
		entries, err := os.ReadDir(scope)
		if err != nil {
			continue
		}
		var found []string
		for _, entry := range entries {
			if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".exe") {
				continue
			}
			found = append(found, filepath.Join(scope, entry.Name()))
		}
		if len(found) == 1 {
			return found[0], nil
		}
		if len(found) > 1 {
			return "", fmt.Errorf("%s 里有多个可执行文件，无法确定要启动哪一个。", scope)
		}
	}
	return "", fmt.Errorf("解压后的目录里没有找到可执行文件。")
}

// sha256File hashes a file without loading it into memory.
func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// verifyArtifact checks the bytes on disk against the manifest before anything
// is written from them.
func verifyArtifact(path string, m payloadManifest) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("找不到安装包：%w", err)
	}
	if info.Size() != int64(m.SizeBytes) {
		return fmt.Errorf("安装包大小与清单不一致。")
	}
	sum, err := sha256File(path)
	if err != nil {
		return err
	}
	if !strings.EqualFold(sum, m.Sha256) {
		return fmt.Errorf("安装包校验失败。")
	}
	return nil
}

// installed is a directory that passed every check; `executable` is absolute.
type installed struct {
	directory  string
	executable string
}

// verifyDirectory reports whether a directory is a complete installation of the
// artifact its own receipt describes. It is what a rollback needs: the previous
// build's manifest is no longer on hand, but its receipt still is.
func verifyDirectory(directory string) (installed, bool) {
	var rec receipt
	if err := readJSON(filepath.Join(directory, receiptName), &rec); err != nil {
		return installed{}, false
	}
	if rec.SchemaVersion != 1 || rec.Product == "" || rec.Version == "" || rec.Executable == "" {
		return installed{}, false
	}
	executable := filepath.Join(directory, filepath.FromSlash(rec.Executable))
	info, err := os.Stat(executable)
	if err != nil || info.IsDir() || info.Size() == 0 {
		return installed{}, false
	}
	sum, err := sha256File(executable)
	if err != nil || !strings.EqualFold(sum, rec.ExecutableSha256) {
		return installed{}, false
	}
	return installed{directory: directory, executable: executable}, true
}

// verifyInstallation reports whether a directory holds a complete, unmodified
// installation of exactly this artifact.
func verifyInstallation(directory string, m payloadManifest) (installed, bool) {
	current, ok := verifyDirectory(directory)
	if !ok {
		return installed{}, false
	}
	var rec receipt
	if err := readJSON(filepath.Join(directory, receiptName), &rec); err != nil {
		return installed{}, false
	}
	if rec.Product != m.Product || rec.Version != m.Version {
		return installed{}, false
	}
	if !strings.EqualFold(rec.ArtifactSha256, m.Sha256) || int64(rec.ArtifactSizeBytes) != int64(m.SizeBytes) {
		return installed{}, false
	}
	return current, true
}

// installZip turns a verified archive into a complete installation directory.
//
// The archive is unpacked beside its destination and renamed into place only
// after it passes verification, so an interrupted or corrupt unpack can never be
// mistaken for an installed version.
func installZip(root, archive string, m payloadManifest, rep report) (installed, error) {
	destination := installDirFor(root, m)
	if current, ok := verifyInstallation(destination, m); ok {
		return current, nil
	}
	if err := verifyArtifact(archive, m); err != nil {
		return installed{}, err
	}
	staging := fmt.Sprintf("%s%s%d-%d", destination, stagingSuffix, os.Getpid(), time.Now().UnixNano())
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return installed{}, err
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return installed{}, err
	}
	cleanup := func() { _ = os.RemoveAll(staging) }
	rep("正在解压", "把应用放进本地目录，只需这一次。", extractStart)
	entries, err := extractZip(archive, staging, rep)
	if err != nil {
		cleanup()
		return installed{}, err
	}
	rep("正在校验", fmt.Sprintf("检查 %d 个文件解压后的完整性。", entries), extractEnd)
	executable, err := findExecutable(staging)
	if err != nil {
		cleanup()
		return installed{}, err
	}
	executableSum, err := sha256File(executable)
	if err != nil {
		cleanup()
		return installed{}, err
	}
	relative, err := filepath.Rel(staging, executable)
	if err != nil {
		cleanup()
		return installed{}, err
	}
	if err := writeJSON(filepath.Join(staging, receiptName), receipt{
		SchemaVersion:     1,
		Product:           m.Product,
		Version:           m.Version,
		ArtifactSha256:    m.Sha256,
		ArtifactSizeBytes: m.SizeBytes,
		Executable:        filepath.ToSlash(relative),
		ExecutableSha256:  executableSum,
		InstalledAt:       time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		cleanup()
		return installed{}, err
	}
	if _, ok := verifyInstallation(staging, m); !ok {
		cleanup()
		return installed{}, fmt.Errorf("解压后的目录没有通过校验。")
	}
	// A previous copy of this exact artifact is replaced, not merged: the app is
	// running from the old inode on Windows, so removal is safe here.
	if err := os.RemoveAll(destination); err != nil {
		cleanup()
		return installed{}, err
	}
	if err := os.Rename(staging, destination); err != nil {
		cleanup()
		return installed{}, err
	}
	current, ok := verifyInstallation(destination, m)
	if !ok {
		return installed{}, fmt.Errorf("安装目录在就位后没有通过校验。")
	}
	return current, nil
}

// extractZip writes every entry under `destination`, refusing anything that
// would land outside it.
func extractZip(archive, destination string, rep report) (int, error) {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return 0, fmt.Errorf("无法读取安装包：%w", err)
	}
	defer reader.Close()
	if len(reader.File) > maxArchiveEntries {
		return 0, fmt.Errorf("安装包里的文件数量超出限制。")
	}
	total := 0
	for _, entry := range reader.File {
		if entry.UncompressedSize64 > uint64(maxExtractedBytes) {
			return 0, fmt.Errorf("安装包解压后的体积超出限制。")
		}
		total += int(entry.UncompressedSize64)
		if int64(total) > maxExtractedBytes {
			return 0, fmt.Errorf("安装包解压后的体积超出限制。")
		}
	}
	count := len(reader.File)
	for index, entry := range reader.File {
		name := strings.TrimPrefix(filepath.ToSlash(entry.Name), "/")
		if name == "" {
			continue
		}
		target := filepath.Join(destination, filepath.FromSlash(name))
		if !inside(destination, target) {
			return 0, fmt.Errorf("安装包里含有越界路径：%s", entry.Name)
		}
		if strings.HasSuffix(entry.Name, "/") {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return 0, err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return 0, err
		}
		if err := writeEntry(entry, target); err != nil {
			return 0, err
		}
		// A per-file callback for 25k files would spend more time repainting than
		// extracting; every 200th file is enough for the bar to look alive.
		if index%200 == 0 || index == count-1 {
			percent := extractStart + (extractEnd-extractStart)*(index+1)/max(count, 1)
			rep("正在解压", fmt.Sprintf("已解压 %d/%d 个文件。", index+1, count), percent)
		}
	}
	return count, nil
}

func writeEntry(entry *zip.File, target string) error {
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	file, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, source); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

// inside reports whether `target` is the directory itself or below it.
func inside(directory, target string) bool {
	root, err := filepath.Abs(directory)
	if err != nil {
		return false
	}
	value, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(root, value)
	if err != nil {
		return false
	}
	return relative == "." || (!strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && relative != "..")
}

// readActive returns the installation a start should use, if any.
func readActive(root string) (activeRecord, bool) {
	var record activeRecord
	if err := readJSON(filepath.Join(root, activeName), &record); err != nil {
		return activeRecord{}, false
	}
	if record.SchemaVersion != 1 || record.Directory == "" {
		return activeRecord{}, false
	}
	return record, true
}

func writeActive(root string, current installed, version string) error {
	return writeJSON(filepath.Join(root, activeName), activeRecord{
		SchemaVersion: 1,
		ActivatedAt:   time.Now().UTC().Format(time.RFC3339),
		Version:       version,
		Directory:     current.directory,
	})
}

// pruneInstalled keeps the active build and the one before it, and removes the
// rest. One previous build is what a rollback needs; anything older is only
// disk. Leftover staging directories from an interrupted install go too.
func pruneInstalled(root, activeDirectory string) {
	parent := filepath.Dir(activeDirectory)
	entries, err := os.ReadDir(parent)
	if err != nil {
		return
	}
	type candidate struct {
		path    string
		modTime time.Time
	}
	var previous []candidate
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(parent, entry.Name())
		// An interrupted unpack is never a valid build, whatever its timestamp.
		if strings.Contains(entry.Name(), stagingSuffix) {
			_ = os.RemoveAll(path)
			continue
		}
		if path == activeDirectory {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		previous = append(previous, candidate{path: path, modTime: info.ModTime()})
	}
	sort.Slice(previous, func(left, right int) bool { return previous[left].modTime.After(previous[right].modTime) })
	for index, entry := range previous {
		if index == 0 {
			continue
		}
		_ = os.RemoveAll(entry.path)
	}
}

func readFile(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		return nil, err
	}
	return raw, nil
}

// writeJSON writes through a temporary file, so a reader never observes a
// half-written receipt or activation record.
func writeJSON(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
	if err := os.WriteFile(temporary, raw, 0o644); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
