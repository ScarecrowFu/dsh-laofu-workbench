//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procSendMessageW        = user32.NewProc("SendMessageW")
	procSetWindowTextW      = user32.NewProc("SetWindowTextW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procDestroyWindow       = user32.NewProc("DestroyWindow")
	procPeekMessageW        = user32.NewProc("PeekMessageW")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessageW    = user32.NewProc("DispatchMessageW")
	procGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procSetProcessDPIAware  = user32.NewProc("SetProcessDPIAware")
	procGetModuleHandleW    = kernel32.NewProc("GetModuleHandleW")
	procCreateMutexW        = kernel32.NewProc("CreateMutexW")
	procCloseHandle         = kernel32.NewProc("CloseHandle")
	procOpenProcess         = kernel32.NewProc("OpenProcess")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procTerminateProcess    = kernel32.NewProc("TerminateProcess")
)

const (
	wsPopup        = 0x80000000
	wsChild        = 0x40000000
	wsVisible      = 0x10000000
	wsDlgFrame     = 0x00400000
	wsClipChildren = 0x02000000
	wsExTopmost    = 0x00000008

	swShow = 5

	pbmSetRange32 = 0x0406
	pbmSetPos     = 0x0402

	pmRemove = 0x0001

	smCxScreen = 0
	smCyScreen = 1

	processSynchronize = 0x00100000
	processTerminate   = 0x0001
	waitTimeout        = 0x00000102
	waitObject0        = 0x00000000

	createNewProcessGroup = 0x00000200

	windowWidth  = 520
	windowHeight = 210
)

type winMsg struct {
	hwnd     uintptr
	message  uint32
	wParam   uintptr
	lParam   uintptr
	time     uint32
	pt       struct{ x, y int32 }
	lPrivate uint32
}

type update struct {
	stage   string
	detail  string
	percent int
	quit    bool
}

// progressWindow is a small top-level window with two labels and a real
// progress bar. Every Win32 call here is best effort: if the window cannot be
// created, the launcher keeps working without one, because a missing progress
// bar must never be the reason an application does not start.
type progressWindow struct {
	title   string
	updates chan update
	done    chan struct{}
	frame   uintptr
	stage   uintptr
	detail  uintptr
	bar     uintptr
	percent uintptr
	started bool
}

func newProgressWindow(title string) *progressWindow {
	return &progressWindow{
		title:   title,
		updates: make(chan update, 32),
		done:    make(chan struct{}),
	}
}

func (w *progressWindow) show() {
	w.started = true
	go w.loop()
	// The first frame is created asynchronously; give it a moment so an early
	// report is not dropped on the floor.
	select {
	case <-w.done:
	case <-time.After(300 * time.Millisecond):
	}
}

func (w *progressWindow) report(stage, detail string, percent int) {
	select {
	case w.updates <- update{stage: stage, detail: detail, percent: percent}:
	default:
	}
}

func (w *progressWindow) fail(err error) {
	message, _ := syscall.UTF16PtrFromString(err.Error())
	caption, _ := syscall.UTF16PtrFromString(w.title + " 启动器")
	procMessageBoxW.Call(0,
		uintptr(unsafe.Pointer(message)),
		uintptr(unsafe.Pointer(caption)),
		0x00000010) // MB_ICONERROR
}

func (w *progressWindow) close() {
	if !w.started {
		// Nothing was ever shown, so nothing has to be torn down: waiting for a
		// loop that was never started would delay every headless run by a second.
		return
	}
	select {
	case w.updates <- update{quit: true}:
	case <-w.done:
	}
	select {
	case <-w.done:
	case <-time.After(time.Second):
	}
}

func (w *progressWindow) loop() {
	runtime.LockOSThread()
	defer close(w.done)
	procSetProcessDPIAware.Call()

	instance, _, _ := procGetModuleHandleW.Call(0)
	screenX, _, _ := procGetSystemMetrics.Call(smCxScreen)
	screenY, _, _ := procGetSystemMetrics.Call(smCyScreen)
	x := (int(screenX) - windowWidth) / 2
	y := (int(screenY) - windowHeight) / 2

	frame, _, _ := procCreateWindowExW.Call(
		wsExTopmost,
		uintptr(unsafe.Pointer(className("STATIC"))),
		uintptr(unsafe.Pointer(utf16(w.title))),
		wsPopup|wsDlgFrame|wsClipChildren,
		uintptr(x), uintptr(y), windowWidth, windowHeight,
		0, 0, instance, 0,
	)
	if frame == 0 {
		return
	}
	w.frame = frame
	w.stage = w.child(frame, "STATIC", "正在准备启动", 28, 26, 464, 26, 0)
	w.detail = w.child(frame, "STATIC", "正在初始化本机工作台。", 28, 56, 464, 40, 0)
	w.bar = w.child(frame, "msctls_progress32", "", 28, 118, 464, 12, 0)
	w.percent = w.child(frame, "STATIC", "0%", 28, 138, 464, 22, 0)
	procShowWindow.Call(frame, swShow)

	ticker := time.NewTicker(16 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case next := <-w.updates:
			if next.quit {
				if w.frame != 0 {
					procDestroyWindow.Call(w.frame)
				}
				return
			}
			w.apply(next)
		case <-ticker.C:
			var message winMsg
			for {
				result, _, _ := procPeekMessageW.Call(
					uintptr(unsafe.Pointer(&message)), 0, 0, 0, pmRemove)
				if result == 0 {
					break
				}
				procTranslateMessage.Call(uintptr(unsafe.Pointer(&message)))
				procDispatchMessageW.Call(uintptr(unsafe.Pointer(&message)))
			}
		}
	}
}

func (w *progressWindow) apply(next update) {
	if w.stage != 0 && next.stage != "" {
		procSetWindowTextW.Call(w.stage, uintptr(unsafe.Pointer(utf16(next.stage))))
	}
	if w.detail != 0 && next.detail != "" {
		procSetWindowTextW.Call(w.detail, uintptr(unsafe.Pointer(utf16(next.detail))))
	}
	if w.bar != 0 {
		procSendMessageW.Call(w.bar, pbmSetRange32, 0, 100)
		procSendMessageW.Call(w.bar, pbmSetPos, uintptr(next.percent), 0)
	}
	if w.percent != 0 {
		procSetWindowTextW.Call(w.percent, uintptr(unsafe.Pointer(utf16(fmt.Sprintf("%d%%", next.percent)))))
	}
}

func (w *progressWindow) child(parent uintptr, class, text string, x, y, width, height int, style uintptr) uintptr {
	instance, _, _ := procGetModuleHandleW.Call(0)
	handle, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className(class))),
		uintptr(unsafe.Pointer(utf16(text))),
		wsChild|wsVisible|style,
		uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		parent, 0, instance, 0,
	)
	return handle
}

func className(name string) *uint16 { return utf16(name) }

func utf16(value string) *uint16 {
	pointer, err := syscall.UTF16PtrFromString(value)
	if err != nil {
		empty, _ := syscall.UTF16PtrFromString("")
		return empty
	}
	return pointer
}

// acquireLock admits one launcher per machine session. Two of them unpacking
// into the same directory would overwrite the files the first one is starting.
func acquireLock(path string) (func(), bool) {
	name, _ := syscall.UTF16PtrFromString(`Local\LaofuWorkbenchLauncher`)
	handle, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		logf("WARN", "could not create launcher mutex: %v", lastErr)
		return func() {}, true
	}
	if errno, ok := lastErr.(syscall.Errno); ok && errno == syscall.ERROR_ALREADY_EXISTS {
		procCloseHandle.Call(handle)
		return func() {}, false
	}
	return func() { procCloseHandle.Call(handle) }, true
}

// startApplication starts the installed build and lets it outlive this process.
func startApplication(executable, version, readyPath string) (int, error) {
	command := exec.Command(executable)
	command.Dir = filepathDir(executable)
	command.Env = append(os.Environ(),
		"LWB_LAUNCHER_PATH="+os.Args[0],
		"LWB_LAUNCHER_VERSION="+launcherVersion,
		"LWB_LAUNCHED_BY=launcher",
		"LWB_VERSION="+version,
		"LWB_STARTUP_READY_FILE="+readyPath,
	)
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup,
		HideWindow:    false,
	}
	if err := command.Start(); err != nil {
		return 0, fmt.Errorf("无法启动工作台：%w", err)
	}
	pid := command.Process.Pid
	_ = command.Process.Release()
	return pid, nil
}

func filepathDir(path string) string {
	for index := len(path) - 1; index >= 0; index-- {
		if path[index] == '\\' || path[index] == '/' {
			return path[:index]
		}
	}
	return "."
}

// processAlive reports whether a pid still runs, without opening it for write.
func processAlive(pid int) bool {
	handle, _, _ := procOpenProcess.Call(processSynchronize, 0, uintptr(pid))
	if handle == 0 {
		return false
	}
	defer procCloseHandle.Call(handle)
	result, _, _ := procWaitForSingleObject.Call(handle, 0)
	return result == waitTimeout
}

// stopProcess ends a process this launcher started, used by rollback.
func stopProcess(pid int) {
	if pid <= 0 {
		return
	}
	handle, _, _ := procOpenProcess.Call(processTerminate|processSynchronize, 0, uintptr(pid))
	if handle == 0 {
		return
	}
	defer procCloseHandle.Call(handle)
	procTerminateProcess.Call(handle, 1)
	procWaitForSingleObject.Call(handle, 5000)
}

var _ = waitObject0
