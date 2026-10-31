package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Bumped only when the launcher's own contract changes — a release that needs a
// newer launcher refuses to install on an older one instead of failing later.
var launcherVersion = "0.0.0-dev"

const (
	productSlug = "laofu-workbench"
	// A first run unpacks a build of more than a gigabyte; a later start is a
	// verification and a spawn. Both budgets are generous on purpose: a slow disk
	// must not turn into an error the user cannot act on.
	readyTimeout       = 120 * time.Second
	rollbackReadyLimit = 60 * time.Second
	bootstrapManifest  = "payload/%s-%s/manifest.json"
)

// silentMode suppresses the failure dialog. `--verify-bootstrap` runs inside a
// packaging step, where a modal box would hang the build instead of reporting an
// exit code.
var silentMode bool

// applyMode is an update started by the workbench. Its outcome has to land in
// the job's result file: the process that started this one is already gone, and
// that file is how the next start tells the user what happened.
var applyMode bool

func main() {
	silentMode = hasArg(os.Args[1:], "--verify-bootstrap")
	applyMode = hasArg(os.Args[1:], "--apply-staged")
	window := newProgressWindow(displayName())
	code := 0
	defer func() {
		window.close()
		os.Exit(code)
	}()
	if err := run(window); err != nil {
		logf("ERROR", "%v", err)
		if applyMode {
			writeUpdateResult("fail " + err.Error())
		}
		if silentMode {
			// A packaging step reads the message here; there is no one to click OK.
			fmt.Fprintln(os.Stderr, err)
		} else {
			window.fail(err)
		}
		code = 1
	}
}

// writeUpdateResult records the outcome where the workbench reads it next start.
// A failure to write it is not a failure to update, so it is only logged.
func writeUpdateResult(text string) {
	path := strings.TrimSpace(os.Getenv("LWB_UPDATE_RESULT"))
	if path == "" {
		return
	}
	if directory := filepath.Dir(path); directory != "" && directory != "." {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			logf("WARN", "could not create the update result directory: %v", err)
			return
		}
	}
	if err := os.WriteFile(path, []byte(text+"\n"), 0o644); err != nil {
		logf("WARN", "could not write the update result: %v", err)
	}
}

func displayName() string {
	if name := strings.TrimSpace(os.Getenv("LWB_PRODUCT_NAME")); name != "" {
		return name
	}
	return "老傅工作台"
}

func run(window *progressWindow) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return err
	}
	launcherDir := filepath.Dir(executable)
	platform, arch := targetPlatform()

	root, err := resolveProductRoot()
	if err != nil {
		return err
	}
	if override := strings.TrimSpace(os.Getenv("LWB_LAUNCHER_ROOT")); override != "" {
		root = override
	}
	mode := "start"
	switch {
	case hasArg(os.Args[1:], "--verify-bootstrap"):
		mode = "verify"
	case hasArg(os.Args[1:], "--apply-staged"):
		mode = "apply"
	}
	if mode == "verify" {
		if verifyRoot := strings.TrimSpace(os.Getenv("LWB_VERIFY_ROOT")); verifyRoot != "" {
			root = verifyRoot
		}
	}

	logf("INFO", "launcher %s starting in %s mode (root %s)", launcherVersion, mode, root)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	release, owned := acquireLock(filepath.Join(root, "launcher.lock"))
	if !owned {
		return fmt.Errorf("工作台正在准备中，请稍候再试。")
	}
	defer release()

	window.report("正在检查本地安装", "确认这个版本可以安全启动。", 8)
	if mode != "verify" {
		window.show()
	}

	var manifest payloadManifest
	var archive string
	switch mode {
	case "apply":
		manifest, archive, err = stagedInstallation(root)
	default:
		manifest, archive, err = bootstrapInstallation(launcherDir, platform, arch)
	}
	if err != nil {
		return err
	}
	// A launch package is installed from the archive inside it, which was
	// unpacked into the staged directory for the length of this run.
	defer removeStagedTemp()
	if err := validateManifest(manifest, platform, arch); err != nil {
		return err
	}

	if mode == "apply" {
		if err := waitForExit(envInt("LWB_WAIT_PID"), 90*time.Second, window); err != nil {
			return err
		}
		settleHost(envInt("LWB_HOST_PID"), window)
	} else {
		if current, ok := activeInstallation(root, manifest); ok {
			logf("INFO", "reusing %s", current.directory)
			// A packaging self-check installs; it must not also launch the app it
			// is checking, or the build would leave a window behind.
			if mode == "verify" {
				window.report("安装包自检通过", "本地目录已就绪，无需解压。", 100)
				return nil
			}
			window.report("正在使用本地副本", "已找到通过校验的应用，无需解压。", 76)
			// A plain start has nothing to fall back to, so the rollback flag is
			// not meaningful here.
			if _, startErr := startAndWait(window, current, manifest.Version, nil); startErr != nil {
				return startErr
			}
			return nil
		}
	}

	window.report("正在准备本地副本", fmt.Sprintf("准备 %s。", manifest.Version), 18)
	current, err := installZip(root, archive, manifest, window.report)
	if err != nil {
		return err
	}
	previous, hadPrevious := readActive(root)
	if err := writeActive(root, current, manifest.Version); err != nil {
		return err
	}
	logf("INFO", "installed %s at %s", manifest.Version, current.directory)
	pruneInstalled(root, current.directory)

	if mode == "verify" {
		window.report("安装包自检通过", "本地目录已就绪。", 100)
		return nil
	}
	// Only an update has something to fall back to, and only when the build that
	// was active a moment ago is a different one.
	var fallback *activeRecord
	if hadPrevious && previous.Version != manifest.Version {
		fallback = &previous
	}
	rolledBack, err := startAndWait(window, current, manifest.Version, fallback)
	if err != nil {
		return err
	}
	if mode == "apply" {
		if rolledBack {
			// The new build installed but never came up, so the update did not
			// succeed: reporting it as installed would greet the user with a
			// version they are not running.
			writeUpdateResult(fmt.Sprintf("fail 新版本没有正常启动，已回到 %s。", previous.Version))
		} else {
			writeUpdateResult("ok " + manifest.Version)
		}
	}
	return nil
}

// activeInstallation returns the recorded build when it is still exactly this
// artifact. A version that matches but a checksum that does not is not enough:
// a rebuilt package can carry the same version.
func activeInstallation(root string, manifest payloadManifest) (installed, bool) {
	record, ok := readActive(root)
	if !ok {
		return installed{}, false
	}
	if record.Version != manifest.Version {
		return installed{}, false
	}
	if filepath.Dir(record.Directory) != filepath.Dir(installDirFor(root, manifest)) {
		return installed{}, false
	}
	return verifyInstallation(record.Directory, manifest)
}

// bootstrapInstallation reads the manifest that shipped beside this launcher.
func bootstrapInstallation(launcherDir, platform, arch string) (payloadManifest, string, error) {
	path := filepath.Join(launcherDir, filepath.FromSlash(fmt.Sprintf(bootstrapManifest, platform, arch)))
	var manifest payloadManifest
	if err := readJSON(path, &manifest); err != nil {
		return manifest, "", fmt.Errorf("启动器缺少安装包清单（%s）。请重新下载完整压缩包。", path)
	}
	if manifest.Product == "" {
		manifest.Product = productSlug
	}
	archive := filepath.Join(filepath.Dir(path), manifest.FileName)
	return manifest, archive, nil
}

// stagedInstallation reads what the workbench left after downloading an update.
//
// The workbench has already verified the release signature and the checksum of
// the file it staged. This only re-establishes the same facts on the way in, so
// that a file changed after staging cannot be installed: the container's size
// and checksum are checked against the staged record, and the archive inside it
// is checked against the manifest it carries.
func stagedInstallation(root string) (payloadManifest, string, error) {
	directory := strings.TrimSpace(os.Getenv("LWB_STAGED_DIR"))
	if directory == "" {
		return payloadManifest{}, "", fmt.Errorf("没有指定待安装的更新包。")
	}
	var staged stagedRecord
	if err := readJSON(filepath.Join(directory, "staged.json"), &staged); err != nil {
		return payloadManifest{}, "", fmt.Errorf("更新包记录不可读：%w", err)
	}
	if !isSafeFileName(staged.FileName) {
		return payloadManifest{}, "", fmt.Errorf("更新包文件名无效。")
	}
	archive := filepath.Join(directory, staged.FileName)
	container := payloadManifest{
		Version:   staged.Version,
		FileName:  staged.FileName,
		Sha256:    staged.Sha256,
		SizeBytes: staged.SizeBytes,
	}
	if err := verifyArtifact(archive, container); err != nil {
		return payloadManifest{}, "", err
	}

	product := strings.TrimSpace(os.Getenv("LWB_PRODUCT"))
	if product == "" {
		product = productSlug
	}
	platform, arch := targetPlatform()

	switch staged.ArtifactType {
	case unpackedType:
		return payloadManifest{
			SchemaVersion: staged.SchemaVersion,
			Product:       product,
			Version:       staged.Version,
			Platform:      platform,
			Arch:          arch,
			Channel:       channelFor(root),
			ArtifactType:  staged.ArtifactType,
			FileName:      staged.FileName,
			Sha256:        staged.Sha256,
			SizeBytes:     staged.SizeBytes,
		}, archive, nil
	case launchPackageType:
		manifest, inner, err := openLaunchPackage(archive, directory)
		if err != nil {
			return payloadManifest{}, "", err
		}
		// The manifest inside the package describes the product and checksum of
		// the build being installed; the version comes from the release the user
		// was offered, and must be the same one.
		if manifest.Version != staged.Version {
			return payloadManifest{}, "", fmt.Errorf("更新包版本与发布记录不一致。")
		}
		if manifest.Product == "" {
			manifest.Product = product
		}
		manifest.Channel = channelFor(root)
		return manifest, inner, nil
	default:
		return payloadManifest{}, "", fmt.Errorf("不支持的更新包类型 %q。", staged.ArtifactType)
	}
}

// channelFor keeps a staged update in the channel the launcher was installed
// from, so a beta build never lands in the stable directory.
func channelFor(root string) string {
	if channel := strings.TrimSpace(os.Getenv("LWB_CHANNEL")); channel != "" {
		return channel
	}
	if record, ok := readActive(root); ok {
		parent := filepath.Base(filepath.Dir(record.Directory))
		if parent != "" && parent != "." {
			return parent
		}
	}
	return "stable"
}

// startAndWait runs the installed build and keeps the progress window in front
// until that build says its window is up.
//
// `rolledBack` reports that the build this call started did not come up and the
// previous one is running instead: the update itself failed, whatever the exit
// code says.
func startAndWait(window *progressWindow, current installed, version string, fallback *activeRecord) (rolledBack bool, err error) {
	window.report("正在启动工作台", "等待界面就绪，通常需要几秒。", 88)
	readyPath, err := readySignalPath(current.directory)
	if err != nil {
		return false, err
	}
	pid, err := startApplication(current.executable, version, readyPath)
	if err != nil {
		// An update that installed but cannot be started must not strand the user
		// on it: the previous build is still on disk and still verified.
		if fallback != nil {
			logf("WARN", "could not start %s: %v; rolling back", version, err)
			return true, rollback(window, 0, version, *fallback)
		}
		return false, err
	}
	if waitForFile(readyPath, readyTimeout) {
		remove(readyPath)
		window.report("工作台已就绪", "可以开始使用。", 100)
		return false, nil
	}
	if fallback == nil {
		// A slow first start is not a failure, and this process is not the app's
		// owner once it is running: say nothing and let it finish starting.
		logf("WARN", "no ready signal within %s; leaving the app running", readyTimeout)
		return false, nil
	}
	return true, rollback(window, pid, version, *fallback)
}

// rollback returns to the build that was active before this update when the new
// one does not come up. Keeping one previous directory exists for exactly this.
func rollback(window *progressWindow, pid int, version string, fallback activeRecord) error {
	root, err := resolveProductRoot()
	if err != nil {
		return err
	}
	if override := strings.TrimSpace(os.Getenv("LWB_LAUNCHER_ROOT")); override != "" {
		root = override
	}
	logf("WARN", "version %s did not report ready within %s; rolling back to %s", version, rollbackReadyLimit, fallback.Version)
	stopProcess(pid)
	window.report("新版本没有正常启动", "正在回到上一个可用版本。", 92)
	previous, ok := verifyDirectory(filepath.FromSlash(fallback.Directory))
	if !ok {
		return fmt.Errorf("新版本没有正常启动（%s），上一个版本也不可用，请重新下载安装包。", version)
	}
	if err := writeActive(root, previous, fallback.Version); err != nil {
		return err
	}
	readyPath, err := readySignalPath(previous.directory)
	if err != nil {
		return err
	}
	if _, err := startApplication(previous.executable, fallback.Version, readyPath); err != nil {
		return err
	}
	if !waitForFile(readyPath, rollbackReadyLimit) {
		return fmt.Errorf("新版本没有正常启动，回到 %s 也失败了，请重新下载安装包。", fallback.Version)
	}
	remove(readyPath)
	window.report("已回到上一个版本", fmt.Sprintf("%s 已启动，请稍后重新更新。", fallback.Version), 100)
	return nil
}

func readySignalPath(directory string) (string, error) {
	path := filepath.Join(directory, "startup", fmt.Sprintf("ready-%d-%d.signal", os.Getpid(), time.Now().UnixNano()))
	return path, nil
}

// settleHost outlasts the Host child of the workbench that just closed, and ends
// it if it lingers. The new build must not race the previous one for the same
// data root and the same local port — and unlike the executable, a node process
// does not always follow its parent out.
func settleHost(pid int, window *progressWindow) {
	if pid <= 0 || !processAlive(pid) {
		return
	}
	window.report("正在准备更新", "等待上一个版本完全退出。", 20)
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	logf("WARN", "the previous host (pid %d) did not exit; ending it", pid)
	stopProcess(pid)
}

func waitForFile(path string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

func waitForExit(pid int, timeout time.Duration, window *progressWindow) error {
	if pid <= 0 {
		return nil
	}
	window.report("正在准备更新", "等待当前窗口关闭。", 16)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("当前工作台没有退出，更新已取消。")
}

func resolveProductRoot() (string, error) {
	if root := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); root != "" {
		return productRoot(root), nil
	}
	if runtime.GOOS != "windows" {
		// Only used by tests and a developer build on another host.
		base, err := os.UserCacheDir()
		if err != nil {
			return "", err
		}
		return productRoot(base), nil
	}
	return "", fmt.Errorf("无法确定本地应用目录。")
}

// targetPlatform is the platform and architecture this launcher installs for.
//
// The binary *is* the target: it is built for one platform, so what it reports
// is what it can run, and a package built for anything else is refused. The
// overrides exist for `--verify-bootstrap`, which may run on a build host that
// is not the target platform; they cannot widen what an installed launcher
// accepts, because a mismatched archive still fails its own checksum.
func targetPlatform() (string, string) {
	platform := "win32"
	if value := strings.TrimSpace(os.Getenv("LWB_PLATFORM")); value != "" {
		platform = value
	}
	arch := "x64"
	switch runtime.GOARCH {
	case "arm64":
		arch = "arm64"
	case "386":
		arch = "ia32"
	}
	if value := strings.TrimSpace(os.Getenv("LWB_ARCH")); value != "" {
		arch = value
	}
	return platform, arch
}

func hasArg(args []string, expected string) bool {
	for _, argument := range args {
		if strings.EqualFold(argument, expected) {
			return true
		}
	}
	return false
}

func envInt(name string) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return 0
	}
	return value
}

func remove(path string) { _ = os.Remove(path) }

// logf appends one line to the launcher log. It never fails a start: a launcher
// that cannot write its log still has to launch the application.
//
// An update names its own log file (`LWB_UPDATE_LOG`, inside the job directory),
// so the steps this process takes end up in the same place the workbench shows
// the user afterwards.
func logf(level, format string, args ...any) {
	line := fmt.Sprintf("%s [%s] %s\n", time.Now().Format(time.RFC3339), level, fmt.Sprintf(format, args...))
	if path := strings.TrimSpace(os.Getenv("LWB_UPDATE_LOG")); path != "" {
		appendLine(path, line)
		return
	}
	root := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if root == "" {
		return
	}
	directory := productRoot(root)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return
	}
	appendLine(filepath.Join(directory, "launcher.log"), line)
}

func appendLine(path, line string) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.WriteString(line)
}
