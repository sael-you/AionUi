// Package addons hosts the optional phone agents (M2, C38 §5): Artemis
// (google/artemis, Apache-2.0) and Mobilerun (droidrun/mobilerun, MIT; its
// Portal APK is AGPL-3.0, personal use). Each lives in its own folder under
// the helper's state dir so removing it frees the disk. Runs are started by
// AionUi only after the owner approved the task text (core's gate); here the
// phone's local switch must be on too, max_minutes is enforced, and stop
// kills the whole process group.
package addons

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// Names of the supported add-ons.
const (
	Artemis   = "artemis"
	Mobilerun = "mobilerun"
)

// Phones lets the host check the target phone (ready + local switch on).
type Phones interface {
	Ready(serial string) bool
	Enabled(serial string) bool
}

// Host implements agent.Addons.
type Host struct {
	// Root is <state>/addons.
	Root string
	// StateDir holds uv, the managed Python and the uv cache.
	StateDir string
	// ADBDir is prepended to PATH for runs (platform-tools), may be "".
	ADBDir string
	Phones Phones
	// Emit sends W2 events (addon_progress); set it with SetEmit.
	Emit func(frame any)
	// Fetch downloads a URL into a file (tests replace it).
	Fetch func(ctx context.Context, url, dest string) error
	// UV overrides the uv binary (tests).
	UV string
	// ExtraEnv is added to the otherwise minimal environment of installs and
	// runs (tests; an owner's proxy setting).
	ExtraEnv []string

	mu   sync.Mutex
	runs map[string]*run
}

type manifest struct {
	Name        string    `json:"name"`
	Version     string    `json:"version"`
	InstalledAt time.Time `json:"installed_at"`
}

func (h *Host) dir(name string) string { return filepath.Join(h.Root, name) }

func (h *Host) manifestPath(name string) string { return filepath.Join(h.dir(name), "addon.json") }

func known(name string) bool { return name == Artemis || name == Mobilerun }

func (h *Host) read(name string) (manifest, bool) {
	raw, err := os.ReadFile(h.manifestPath(name))
	if err != nil {
		return manifest{}, false
	}
	var m manifest
	if json.Unmarshal(raw, &m) != nil || m.Name != name {
		return manifest{}, false
	}
	return m, true
}

func dirSize(path string) uint64 {
	var total uint64
	_ = filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += uint64(info.Size())
			}
		}
		return nil
	})
	return total
}

// Installed implements agent.Addons (inventory).
func (h *Host) Installed() []wire.Addon {
	out := []wire.Addon{}
	for _, name := range []string{Artemis, Mobilerun} {
		m, ok := h.read(name)
		if !ok {
			continue
		}
		v := m.Version
		size := dirSize(h.dir(name))
		out = append(out, wire.Addon{Name: name, Version: &v, DiskBytes: &size})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
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

var versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// MaxTaskLen bounds a task text.
const MaxTaskLen = 4000

// Handle implements agent.Addons.
func (h *Host) Handle(ctx context.Context, verb string, args []byte) (any, error) {
	switch verb {
	case "addon_install":
		var in struct {
			Name    string  `json:"name"`
			Version *string `json:"version"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		if !known(in.Name) {
			return nil, bad("unknown add-on %q", in.Name)
		}
		version := ""
		if in.Version != nil {
			version = *in.Version
			if !versionPattern.MatchString(version) {
				return nil, bad("invalid version")
			}
		}
		installed, err := h.install(ctx, in.Name, version)
		if err != nil {
			return nil, err
		}
		return map[string]string{"name": in.Name, "version": installed}, nil
	case "addon_remove":
		var in struct {
			Name string `json:"name"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		if !known(in.Name) {
			return nil, bad("unknown add-on %q", in.Name)
		}
		if h.busy(in.Name) {
			return nil, wire.Errorf(wire.ErrBusy, "%s is running a task", in.Name)
		}
		if err := os.RemoveAll(h.dir(in.Name)); err != nil {
			return nil, err
		}
		h.freeShared()
		return nil, nil
	case "addon_run":
		var in struct {
			Name       string `json:"name"`
			Task       string `json:"task"`
			Device     string `json:"device"`
			MaxMinutes int    `json:"max_minutes"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		if _, ok := h.read(in.Name); !ok {
			return nil, wire.Errorf(wire.ErrRefused, "add-on %q is not installed", in.Name)
		}
		task := strings.TrimSpace(in.Task)
		if task == "" || len([]rune(task)) > MaxTaskLen {
			return nil, bad("task must be 1–%d characters", MaxTaskLen)
		}
		if in.MaxMinutes < 1 || in.MaxMinutes > 60 {
			return nil, bad("max_minutes must be 1–60")
		}
		if h.Phones == nil || !h.Phones.Ready(in.Device) {
			return nil, wire.Errorf(wire.ErrUnknownDevice, "no ready phone %q", in.Device)
		}
		if !h.Phones.Enabled(in.Device) {
			return nil, wire.Errorf(wire.ErrSwitchOff, "%s is switched off in the helper", in.Device)
		}
		id, err := h.start(in.Name, task, in.Device, time.Duration(in.MaxMinutes)*time.Minute)
		if err != nil {
			return nil, err
		}
		return map[string]string{"run_id": id}, nil
	case "addon_stop":
		var in struct {
			RunID string `json:"run_id"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		if !h.stop(in.RunID) {
			return nil, bad("no such run")
		}
		return nil, nil
	}
	return nil, wire.Errorf(wire.ErrRefused, "unknown verb %q", verb)
}

// ErrNotInstalled is returned when uv is needed but missing.
var ErrNotInstalled = errors.New("not installed")

// SetEmit sets the event sink (the relay session's sender).
func (h *Host) SetEmit(e func(any)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.Emit = e
}

func (h *Host) emit(frame any) {
	h.mu.Lock()
	e := h.Emit
	h.mu.Unlock()
	if e != nil {
		e(frame)
	}
}

func (h *Host) progress(device, runID, state, message string) {
	data := map[string]string{"run_id": runID, "state": state}
	if message != "" {
		data["message"] = message
	}
	h.emit(wire.NewEvent(device, wire.EventAddonProgress, data))
}

func trimLine(s string) string {
	s = strings.TrimSpace(stripANSI(s))
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

var ansi = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)

func stripANSI(s string) string { return ansi.ReplaceAllString(s, "") }

func fmtErr(step string, err error) error { return fmt.Errorf("%s: %w", step, err) }
