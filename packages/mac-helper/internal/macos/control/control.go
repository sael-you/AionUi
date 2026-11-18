// Package control runs the W2 `mac_*` verbs (M3): screenshot, accessibility
// tree, click, type, key, open app on the Mac the helper runs on.
//
// macOS gates all of it: Screen Recording (screenshots) and Accessibility
// (input, UI tree) must be granted to the helper in System Settings → Privacy
// & Security. The grants are tied to the binary's signature; the helper is
// ad-hoc signed, so every new build needs them again. Coordinates are points
// on the main display; screenshots are scaled to points so they match.
package control

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/shot"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// Input is the CoreGraphics layer (purego on darwin, a stub elsewhere).
type Input interface {
	ScreenGranted() bool
	RequestScreen()
	AccessibilityGranted() bool
	MainDisplayPoints() (w, h int)
	Click(x, y float64) error
	TypeText(s string) error
	Key(code uint16, flags uint64) error
}

// Controller implements agent.Mac.
type Controller struct {
	In Input
	// Run executes a helper tool (screencapture, osascript, open); tests replace it.
	Run func(ctx context.Context, name string, args ...string) ([]byte, error)
	// TempDir holds screenshots for the moment they are read.
	TempDir string
}

// New returns a Controller for this OS.
func New(tempDir string) *Controller {
	return &Controller{In: newInput(), Run: runTool, TempDir: tempDir}
}

func runTool(ctx context.Context, name string, args ...string) ([]byte, error) {
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		var stderr string
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = strings.TrimSpace(string(ee.Stderr))
		}
		return nil, fmt.Errorf("%s: %v %s", name, err, stderr)
	}
	return out, nil
}

// Supported reports whether this build can control a Mac.
func Supported() bool { return runtime.GOOS == "darwin" }

// Info implements agent.Mac (inventory).
func (c *Controller) Info() wire.Mac {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	name, _ := os.Hostname()
	if out, err := c.Run(ctx, "/usr/sbin/scutil", "--get", "ComputerName"); err == nil && strings.TrimSpace(string(out)) != "" {
		name = strings.TrimSpace(string(out))
	}
	info := wire.Mac{Name: name, PermissionsOK: c.In.ScreenGranted() && c.In.AccessibilityGranted()}
	if out, err := c.Run(ctx, "/usr/bin/sw_vers", "-productVersion"); err == nil {
		v := strings.TrimSpace(string(out))
		info.OSVersion = &v
	}
	return info
}

func bad(format string, a ...any) error { return wire.Errorf(wire.ErrBadArgs, format, a...) }

func decode(args []byte, v any) error {
	if len(args) == 0 || string(args) == "null" {
		args = []byte("{}")
	}
	dec := json.NewDecoder(strings.NewReader(string(args)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return bad("%v", err)
	}
	return nil
}

func needAccessibility(in Input) error {
	if !in.AccessibilityGranted() {
		return wire.Errorf(wire.ErrRefused, "grant Accessibility to aionui-mac-helper in System Settings → Privacy & Security → Accessibility")
	}
	return nil
}

var bundlePattern = regexp.MustCompile(`^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$`)

// MaxTypeLen bounds one mac_type.
const MaxTypeLen = 1000

// Handle implements agent.Mac.
func (c *Controller) Handle(ctx context.Context, verb string, args []byte) (any, error) {
	switch verb {
	case "mac_foreground":
		if err := decode(args, &struct{}{}); err != nil {
			return nil, err
		}
		return map[string]string{"bundle_id": c.frontBundleID(ctx)}, nil
	case "mac_screenshot":
		if err := decode(args, &struct{}{}); err != nil {
			return nil, err
		}
		return c.screenshot(ctx)
	case "mac_ax_tree":
		if err := decode(args, &struct{}{}); err != nil {
			return nil, err
		}
		if err := needAccessibility(c.In); err != nil {
			return nil, err
		}
		return c.axTree(ctx)
	case "mac_click":
		var in struct{ X, Y float64 }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		w, h := c.In.MainDisplayPoints()
		if in.X < 0 || in.Y < 0 || (w > 0 && in.X >= float64(w)) || (h > 0 && in.Y >= float64(h)) {
			return nil, bad("point outside the main display (%dx%d points)", w, h)
		}
		if err := needAccessibility(c.In); err != nil {
			return nil, err
		}
		return nil, c.In.Click(in.X, in.Y)
	case "mac_type":
		var in struct{ Value string }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		if in.Value == "" || len([]rune(in.Value)) > MaxTypeLen {
			return nil, bad("value must be 1–%d characters", MaxTypeLen)
		}
		if err := needAccessibility(c.In); err != nil {
			return nil, err
		}
		return nil, c.In.TypeText(in.Value)
	case "mac_key":
		var in struct{ Code string }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		code, flags, err := ParseKey(in.Code)
		if err != nil {
			return nil, bad("%v", err)
		}
		if err := needAccessibility(c.In); err != nil {
			return nil, err
		}
		return nil, c.In.Key(code, flags)
	case "mac_open_app":
		var in struct {
			BundleID string `json:"bundle_id"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		if !bundlePattern.MatchString(in.BundleID) || len(in.BundleID) > 200 {
			return nil, bad("invalid bundle_id")
		}
		octx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		_, err := c.Run(octx, "/usr/bin/open", "-b", in.BundleID)
		return nil, err
	}
	return nil, wire.Errorf(wire.ErrRefused, "unknown verb %q", verb)
}

var lsappinfoBundle = regexp.MustCompile(`"CFBundleIdentifier"\s*=\s*"([^"]+)"`)

// frontBundleID is the frontmost application's bundle id, "" when unknown
// (core then asks the owner before every Mac action). Needs no macOS
// permission: LaunchServices' `lsappinfo`, then AppleScript's own
// `path to frontmost application` as fallback.
func (c *Controller) frontBundleID(ctx context.Context) string {
	fctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if asn, err := c.Run(fctx, "/usr/bin/lsappinfo", "front"); err == nil {
		if a := strings.TrimSpace(string(asn)); a != "" && !strings.ContainsAny(a, " \n") {
			if out, err := c.Run(fctx, "/usr/bin/lsappinfo", "info", "-only", "bundleid", a); err == nil {
				if m := lsappinfoBundle.FindStringSubmatch(string(out)); m != nil && validBundle(m[1]) {
					return m[1]
				}
			}
		}
	}
	out, err := c.Run(fctx, "/usr/bin/osascript", "-e", "id of application (path to frontmost application as text)")
	if id := strings.TrimSpace(string(out)); err == nil && validBundle(id) {
		return id
	}
	return ""
}

func validBundle(id string) bool {
	return len(id) <= 200 && bundlePattern.MatchString(id)
}

func (c *Controller) screenshot(ctx context.Context) (any, error) {
	if !c.In.ScreenGranted() {
		c.In.RequestScreen()
		return nil, wire.Errorf(wire.ErrRefused, "grant Screen Recording to aionui-mac-helper in System Settings → Privacy & Security → Screen Recording")
	}
	f, err := os.CreateTemp(c.TempDir, "mac-shot-*.png")
	if err != nil {
		return nil, err
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)
	sctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	// -x no sound, -m main display only, -t png.
	if _, err := c.Run(sctx, "/usr/sbin/screencapture", "-x", "-m", "-t", "png", path); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	w, _ := c.In.MainDisplayPoints()
	return shot.EncodeToWidth(raw, w)
}

// keyCodes are macOS virtual key codes (Carbon kVK_*).
var keyCodes = map[string]uint16{
	"a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
	"w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
	"=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
	"p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
	".": 47, "`": 50, "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
	"escape": 53, "esc": 53, "forward_delete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
	"left": 123, "right": 124, "down": 125, "up": 126, "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96,
	"f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
}

// CGEventFlags for modifiers.
var modifiers = map[string]uint64{
	"cmd": 0x100000, "command": 0x100000, "shift": 0x20000, "alt": 0x80000, "option": 0x80000,
	"ctrl": 0x40000, "control": 0x40000,
}

// ParseKey reads "return", "cmd+c", "cmd+shift+4" into a key code and flags.
func ParseKey(s string) (uint16, uint64, error) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(s)), "+")
	if len(parts) == 0 || len(parts) > 4 || parts[len(parts)-1] == "" {
		return 0, 0, fmt.Errorf("invalid key %q", s)
	}
	var flags uint64
	for _, m := range parts[:len(parts)-1] {
		f, ok := modifiers[m]
		if !ok {
			return 0, 0, fmt.Errorf("unknown modifier %q", m)
		}
		flags |= f
	}
	code, ok := keyCodes[parts[len(parts)-1]]
	if !ok {
		return 0, 0, fmt.Errorf("unknown key %q", parts[len(parts)-1])
	}
	return code, flags, nil
}

// axScript dumps the frontmost app's windows as JSON (JXA). Secure text
// fields never report their value; depth and node count are bounded.
const axScript = `
const MAX_DEPTH = 6, MAX_NODES = 400;
let count = 0;
function v(f) { try { const x = f(); return x === null || x === undefined ? undefined : x; } catch (e) { return undefined; } }
function node(e, depth) {
  count++;
  const role = v(() => e.role());
  const sub = v(() => e.subrole());
  const o = { role: role, subrole: sub, title: v(() => e.title()), name: v(() => e.name()), description: v(() => e.description()) };
  if (sub !== 'AXSecureTextField') { const val = v(() => e.value()); if (typeof val === 'string' || typeof val === 'number') o.value = String(val).slice(0, 200); }
  const p = v(() => e.position()), s = v(() => e.size());
  if (p && s) o.frame = [p[0], p[1], s[0], s[1]];
  if (depth < MAX_DEPTH && count < MAX_NODES) {
    const kids = v(() => e.uiElements()) || [];
    o.children = [];
    for (let i = 0; i < kids.length && count < MAX_NODES; i++) o.children.push(node(kids[i], depth + 1));
  }
  return o;
}
const se = Application('System Events');
const proc = se.processes.whose({ frontmost: true })[0];
JSON.stringify({ app: v(() => proc.name()), bundle_id: v(() => proc.bundleIdentifier()), windows: (v(() => proc.windows()) || []).map(w => node(w, 0)), truncated: count >= MAX_NODES });
`

func (c *Controller) axTree(ctx context.Context) (any, error) {
	actx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := c.Run(actx, "/usr/bin/osascript", "-l", "JavaScript", "-e", axScript)
	if err != nil {
		return nil, err
	}
	var tree any
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(out))), &tree); err != nil {
		return nil, fmt.Errorf("accessibility tree: %w", err)
	}
	return map[string]any{"tree": tree}, nil
}
