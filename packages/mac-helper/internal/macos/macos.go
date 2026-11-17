// Package macos holds the helper's macOS integrations: notifications (the
// visible "agents are using …" sign) and the launchd agent that keeps the
// helper running. On other systems they are no-ops / errors (tests, CI).
package macos

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Label is the launchd label of the helper.
const Label = "com.aionui.mac-helper"

// AppleScriptString quotes s as an AppleScript string literal.
func AppleScriptString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' {
			return ' '
		}
		return r
	}, s)
	return `"` + s + `"`
}

// Notifier shows macOS notifications through osascript (argv, no shell).
type Notifier struct{}

// Notify implements agent.Notifier.
func (Notifier) Notify(title, body string) {
	if runtime.GOOS != "darwin" {
		fmt.Fprintf(os.Stderr, "[notify] %s — %s\n", title, body)
		return
	}
	script := "display notification " + AppleScriptString(body) + " with title " + AppleScriptString(title)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, "/usr/bin/osascript", "-e", script).Run()
}

// PlistPath is ~/Library/LaunchAgents/<Label>.plist.
func PlistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", Label+".plist"), nil
}

func xmlEscape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// Plist is the launchd agent: run `<bin> run` at login, restart on exit,
// stdout/stderr into the state dir.
func Plist(bin, stateDir string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>` + Label + `</string>
  <key>ProgramArguments</key>
  <array><string>` + xmlEscape(bin) + `</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>` + xmlEscape(filepath.Join(stateDir, "helper.out.log")) + `</string>
  <key>StandardErrorPath</key><string>` + xmlEscape(filepath.Join(stateDir, "helper.err.log")) + `</string>
</dict>
</plist>
`
}

func launchctl(args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/bin/launchctl", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl %s: %v: %s", strings.Join(args, " "), err, bytes.TrimSpace(out))
	}
	return nil
}

func domain() string { return "gui/" + strconv.Itoa(os.Getuid()) }

// InstallAgent writes the plist and (re)loads it for the logged-in user.
func InstallAgent(bin, stateDir string) (string, error) {
	if runtime.GOOS != "darwin" {
		return "", fmt.Errorf("launchd is macOS only")
	}
	path, err := PlistPath()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(Plist(bin, stateDir)), 0o644); err != nil {
		return "", err
	}
	_ = launchctl("bootout", domain()+"/"+Label)
	if err := launchctl("bootstrap", domain(), path); err != nil {
		return "", err
	}
	return path, nil
}

// UninstallAgent unloads and deletes the plist.
func UninstallAgent() error {
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("launchd is macOS only")
	}
	path, err := PlistPath()
	if err != nil {
		return err
	}
	_ = launchctl("bootout", domain()+"/"+Label)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
