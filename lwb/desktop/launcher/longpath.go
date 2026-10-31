package main

import (
	"runtime"
	"strings"
)

// Win32 refuses a path longer than MAX_PATH (260 characters) unless it is given
// in the extended-length form. The install directory alone is around a hundred
// characters — `%LOCALAPPDATA%\LaofuWorkbench\program\win32-x64\stable\<version>-<sha>`
// — and an unpacked Electron tree with its production dependencies goes deep
// from there, so "解压失败" on a user's machine is a realistic outcome of
// ignoring this.
//
// 248 is the practical threshold: the limit counts the terminating null and
// some Win32 calls reserve another twelve characters for an 8.3 name.
const legacyPathLimit = 248

// nativePath returns the form of `path` this host's file APIs accept.
func nativePath(path string) string {
	return extendedPath(path, runtime.GOOS == "windows")
}

// extendedPath prefixes `path` when Windows would otherwise reject its length.
//
// Only paths that need it are changed, so the ordinary case keeps producing the
// same bytes it always did. Extended paths skip normalisation, which is why the
// forms Windows cannot represent this way — forward slashes, relative paths —
// are returned untouched: they are also the forms that cannot be long.
func extendedPath(path string, windows bool) string {
	if !windows || len(path) < legacyPathLimit {
		return path
	}
	if strings.HasPrefix(path, `\\?\`) || strings.HasPrefix(path, `\\.\`) {
		return path
	}
	if strings.Contains(path, "/") {
		return path
	}
	// `C:\…`
	if len(path) >= 3 && path[1] == ':' && path[2] == '\\' && isDriveLetter(path[0]) {
		return `\\?\` + path
	}
	// `\\server\share\…` becomes `\\?\UNC\server\share\…`.
	if strings.HasPrefix(path, `\\`) {
		return `\\?\UNC` + path[1:]
	}
	return path
}

func isDriveLetter(character byte) bool {
	return character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z'
}
