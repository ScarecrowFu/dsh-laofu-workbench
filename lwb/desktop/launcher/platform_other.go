//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// progressWindow on a non-Windows host only prints. The launcher is a Windows
// product; this file exists so its logic can be built and tested elsewhere.
type progressWindow struct {
	title   string
	shown   bool
	updates chan struct{}
}

func newProgressWindow(title string) *progressWindow {
	return &progressWindow{title: title}
}

func (w *progressWindow) show() { w.shown = true }

func (w *progressWindow) report(stage, detail string, percent int) {
	fmt.Printf("[%3d%%] %s — %s\n", percent, stage, detail)
}

func (w *progressWindow) fail(err error) { fmt.Fprintf(os.Stderr, "%s: %v\n", w.title, err) }

func (w *progressWindow) close() {}

// acquireLock uses an exclusive lock file on hosts without a Windows mutex.
func acquireLock(path string) (func(), bool) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return func() {}, false
	}
	_, _ = file.WriteString(fmt.Sprintf("%d\n", os.Getpid()))
	_ = file.Close()
	return func() { _ = os.Remove(path) }, true
}

func startApplication(executable, version, readyPath string) (int, error) {
	command := exec.Command(executable)
	command.Dir = filepath.Dir(executable)
	command.Env = append(os.Environ(),
		"LWB_LAUNCHER_PATH="+os.Args[0],
		"LWB_LAUNCHER_VERSION="+launcherVersion,
		"LWB_LAUNCHED_BY=launcher",
		"LWB_VERSION="+version,
		"LWB_STARTUP_READY_FILE="+readyPath,
	)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		return 0, fmt.Errorf("无法启动工作台：%w", err)
	}
	pid := command.Process.Pid
	_ = command.Process.Release()
	return pid, nil
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

func stopProcess(pid int) {
	if pid <= 0 {
		return
	}
	if process, err := os.FindProcess(pid); err == nil {
		_ = process.Kill()
		time.Sleep(200 * time.Millisecond)
	}
}
