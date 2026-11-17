package adb

import (
	"bytes"
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Phone runs the W2 phone verbs on one device. Each method is one fixed adb
// command; nothing an agent sends reaches a shell unquoted.
type Phone struct {
	R      Runner
	Serial string
}

const (
	shortTimeout = 15 * time.Second
	longTimeout  = 60 * time.Second
	// MaxCoord bounds tap/swipe coordinates (screen pixels).
	MaxCoord = 10000
	// MaxSwipeMs bounds a swipe's duration.
	MaxSwipeMs = 5000
	// MaxLogLines bounds one logcat read.
	MaxLogLines = 2000
)

func (p Phone) run(ctx context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return p.R.Run(ctx, append([]string{"-s", p.Serial}, args...)...)
}

// shell runs `adb shell <line>` with every argument quoted.
func (p Phone) shell(ctx context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	return p.run(ctx, timeout, "shell", ShellLine(args...))
}

// Screenshot returns a PNG of the screen.
func (p Phone) Screenshot(ctx context.Context) ([]byte, error) {
	png, err := p.run(ctx, shortTimeout, "exec-out", "screencap", "-p")
	if err != nil {
		return nil, err
	}
	if !bytes.HasPrefix(png, []byte("\x89PNG")) {
		return nil, fmt.Errorf("screencap did not return a PNG (screen locked or secure window?)")
	}
	return png, nil
}

// UITree returns the uiautomator XML of the current screen.
func (p Phone) UITree(ctx context.Context) (string, error) {
	out, err := p.run(ctx, longTimeout, "exec-out", "uiautomator", "dump", "/dev/tty")
	if err != nil {
		return "", err
	}
	xml := string(out)
	// uiautomator appends a status line after the document.
	if end := strings.LastIndex(xml, "</hierarchy>"); end >= 0 {
		xml = xml[:end+len("</hierarchy>")]
	}
	if !strings.Contains(xml, "<hierarchy") {
		return "", fmt.Errorf("uiautomator returned no hierarchy")
	}
	return xml, nil
}

func checkCoord(name string, v int) error {
	if v < 0 || v > MaxCoord {
		return fmt.Errorf("%s out of range 0–%d", name, MaxCoord)
	}
	return nil
}

// Tap taps a screen point.
func (p Phone) Tap(ctx context.Context, x, y int) error {
	if err := errorsJoin(checkCoord("x", x), checkCoord("y", y)); err != nil {
		return err
	}
	_, err := p.shell(ctx, shortTimeout, "input", "tap", strconv.Itoa(x), strconv.Itoa(y))
	return err
}

// Swipe swipes between two points in durationMs.
func (p Phone) Swipe(ctx context.Context, x1, y1, x2, y2, durationMs int) error {
	if err := errorsJoin(checkCoord("x1", x1), checkCoord("y1", y1), checkCoord("x2", x2), checkCoord("y2", y2)); err != nil {
		return err
	}
	if durationMs < 0 || durationMs > MaxSwipeMs {
		return fmt.Errorf("duration_ms out of range 0–%d", MaxSwipeMs)
	}
	_, err := p.shell(ctx, shortTimeout, "input", "swipe",
		strconv.Itoa(x1), strconv.Itoa(y1), strconv.Itoa(x2), strconv.Itoa(y2), strconv.Itoa(durationMs))
	return err
}

// Text types printable ASCII into the focused field.
func (p Phone) Text(ctx context.Context, value string) error {
	encoded, err := InputText(value)
	if err != nil {
		return err
	}
	_, err = p.shell(ctx, shortTimeout, "input", "text", encoded)
	return err
}

// Key sends one key event (KEYCODE_* name or number).
func (p Phone) Key(ctx context.Context, key string) error {
	if !ValidKey(key) {
		return fmt.Errorf("invalid key %q", key)
	}
	_, err := p.shell(ctx, shortTimeout, "input", "keyevent", key)
	return err
}

// Launch starts an app's launcher activity.
func (p Phone) Launch(ctx context.Context, pkg string) error {
	if !ValidPackage(pkg) {
		return fmt.Errorf("invalid package %q", pkg)
	}
	out, err := p.shell(ctx, shortTimeout, "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1")
	if err != nil {
		return err
	}
	if strings.Contains(string(out), "No activities found") {
		return fmt.Errorf("package %s has no launcher activity (not installed?)", pkg)
	}
	return nil
}

var resumedPattern = regexp.MustCompile(`(?:topResumedActivity|mResumedActivity|ResumedActivity)[=:]\s*ActivityRecord\{\S+ \S+ ([A-Za-z0-9_.]+)/([A-Za-z0-9_.$]+)`)

// Foreground names the app on screen (the crucial-app check in core needs it).
type Foreground struct {
	Package  string `json:"package"`
	Activity string `json:"activity"`
}

// ForegroundApp reads the resumed activity from dumpsys.
func (p Phone) ForegroundApp(ctx context.Context) (Foreground, error) {
	out, err := p.shell(ctx, shortTimeout, "dumpsys", "activity", "activities")
	if err != nil {
		return Foreground{}, err
	}
	return ParseForeground(string(out))
}

// ParseForeground extracts the resumed activity from `dumpsys activity activities`.
func ParseForeground(out string) (Foreground, error) {
	m := resumedPattern.FindStringSubmatch(out)
	if m == nil {
		return Foreground{}, fmt.Errorf("no resumed activity (screen off or locked?)")
	}
	activity := m[2]
	if strings.HasPrefix(activity, ".") {
		activity = m[1] + activity
	}
	return Foreground{Package: m[1], Activity: activity}, nil
}

// Logcat returns the last lines logged by one app.
func (p Phone) Logcat(ctx context.Context, pkg string, lines int) (string, error) {
	if !ValidPackage(pkg) {
		return "", fmt.Errorf("invalid package %q", pkg)
	}
	if lines <= 0 || lines > MaxLogLines {
		return "", fmt.Errorf("lines out of range 1–%d", MaxLogLines)
	}
	pidOut, err := p.shell(ctx, shortTimeout, "pidof", pkg)
	pid := strings.Fields(string(pidOut))
	if err != nil || len(pid) == 0 {
		return "", fmt.Errorf("%s is not running", pkg)
	}
	if _, convErr := strconv.Atoi(pid[0]); convErr != nil {
		return "", fmt.Errorf("unexpected pidof output")
	}
	out, err := p.run(ctx, shortTimeout, "logcat", "-d", "-t", strconv.Itoa(lines), "--pid="+pid[0])
	return string(out), err
}

// InstallAPK installs a local, already verified APK file.
func (p Phone) InstallAPK(ctx context.Context, path string) error {
	out, err := p.run(ctx, 5*time.Minute, "install", "-r", path)
	if err != nil {
		return err
	}
	if !strings.Contains(string(out), "Success") {
		return fmt.Errorf("install failed: %s", strings.TrimSpace(lastLine(string(out))))
	}
	return nil
}

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "\n"); i >= 0 {
		return s[i+1:]
	}
	return s
}

func errorsJoin(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

var propPattern = regexp.MustCompile(`^[a-z0-9_.]{1,90}$`)

// Prop reads one system property ("" when unknown).
func (p Phone) Prop(ctx context.Context, name string) string {
	if !propPattern.MatchString(name) {
		return ""
	}
	out, err := p.shell(ctx, shortTimeout, "getprop", name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// ChromeDevtools reports whether Chrome's DevTools socket is open (Chrome
// running, USB/Wi-Fi debugging on).
func (p Phone) ChromeDevtools(ctx context.Context) bool {
	out, err := p.shell(ctx, shortTimeout, "cat", "/proc/net/unix")
	return err == nil && strings.Contains(string(out), "@chrome_devtools_remote")
}
