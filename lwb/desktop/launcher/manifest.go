// Package main installs one unpacked LWB build into a reusable local directory
// and starts it, so that a portable download is extracted once instead of on
// every launch.
package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// maxArtifact and maxExtracted bound what one package may cost on disk. They are
// deliberately the same ceiling the app enforces on a downloaded update, so a
// hand-edited manifest cannot make the launcher write an unbounded tree.
const (
	maxArtifactBytes  = int64(4) << 30
	maxExtractedBytes = int64(8) << 30
	maxArchiveEntries = 100_000
)

// number is a JSON integer written either as a number or as a string.
//
// The payload manifest is written by the packaging script, which uses a number;
// ATS publishes `sizeBytes` as a string, and the app copies that field verbatim
// into the staged record. Accepting both keeps one parser for both sources.
type number int64

func (n *number) UnmarshalJSON(raw []byte) error {
	text := strings.TrimSpace(string(raw))
	if text == "null" || text == "" {
		*n = 0
		return nil
	}
	text = strings.Trim(text, `"`)
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return fmt.Errorf("expected an integer, got %q", text)
	}
	*n = number(value)
	return nil
}

func (n number) MarshalJSON() ([]byte, error) { return []byte(strconv.FormatInt(int64(n), 10)), nil }

// payloadManifest is the `manifest.json` shipped beside the package, and the
// subset of an ATS release manifest the launcher needs for a staged update.
type payloadManifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	Product       string `json:"product"`
	ProductName   string `json:"productName"`
	Version       string `json:"version"`
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	Channel       string `json:"channel"`
	ArtifactType  string `json:"artifactType"`
	FileName      string `json:"fileName"`
	Sha256        string `json:"sha256"`
	SizeBytes     number `json:"sizeBytes"`
}

// stagedRecord is what the workbench writes next to a downloaded update. The
// signature over the release manifest was already verified by the app before it
// wrote this file; the launcher re-checks the bytes it is about to install.
type stagedRecord struct {
	SchemaVersion int    `json:"schemaVersion"`
	Version       string `json:"version"`
	FileName      string `json:"fileName"`
	Sha256        string `json:"sha256"`
	SizeBytes     number `json:"sizeBytes"`
	ArtifactType  string `json:"artifactType"`
	PreparedAt    string `json:"preparedAt"`
}

// receipt is written inside an installed directory. It is the only proof that a
// directory is a complete installation of one specific artifact: the version is
// not enough, because a rebuilt package can carry the same version.
type receipt struct {
	SchemaVersion     int    `json:"schemaVersion"`
	Product           string `json:"product"`
	Version           string `json:"version"`
	ArtifactSha256    string `json:"artifactSha256"`
	ArtifactSizeBytes number `json:"artifactSizeBytes"`
	Executable        string `json:"executable"`
	ExecutableSha256  string `json:"executableSha256"`
	InstalledAt       string `json:"installedAt"`
}

// activeRecord names the installation a start should use. It is written only
// after the new directory is complete, so a crash mid-install leaves the
// previous version in charge.
type activeRecord struct {
	SchemaVersion int    `json:"schemaVersion"`
	ActivatedAt   string `json:"activatedAt"`
	Version       string `json:"version"`
	Directory     string `json:"directory"`
}

func readJSON(path string, target any) error {
	raw, err := readFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

// validateManifest rejects a manifest that could place this launcher's output
// somewhere other than a directory of its own, or that describes the wrong
// product, platform or architecture.
func validateManifest(m payloadManifest, platform, arch string) error {
	if m.SchemaVersion != 1 {
		return fmt.Errorf("不支持的清单版本 %d。", m.SchemaVersion)
	}
	if strings.TrimSpace(m.Product) == "" || strings.TrimSpace(m.Version) == "" {
		return fmt.Errorf("清单缺少产品或版本。")
	}
	if m.Platform != platform || m.Arch != arch {
		return fmt.Errorf("这个安装包是 %s-%s，当前系统是 %s-%s。", m.Platform, m.Arch, platform, arch)
	}
	if m.ArtifactType != "unpacked-zip" {
		return fmt.Errorf("不支持的安装包类型 %q。", m.ArtifactType)
	}
	if !isSafeFileName(m.FileName) {
		return fmt.Errorf("安装包文件名无效。")
	}
	if !strings.HasSuffix(strings.ToLower(m.FileName), ".zip") {
		return fmt.Errorf("安装包应为 .zip 文件。")
	}
	if len(m.Sha256) != 64 || strings.ToLower(m.Sha256) != m.Sha256 {
		return fmt.Errorf("安装包校验值无效。")
	}
	if int64(m.SizeBytes) < 1 || int64(m.SizeBytes) > maxArtifactBytes {
		return fmt.Errorf("安装包大小超出限制。")
	}
	return nil
}

// isSafeFileName reports whether a server-supplied name can only mean a file
// inside one directory.
func isSafeFileName(name string) bool {
	return name != "" && len(name) <= 255 && !strings.ContainsAny(name, `/\`) && name != "." && name != ".."
}
