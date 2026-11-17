package addons

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

type phones struct{ on map[string]bool }

func (p phones) Ready(s string) bool   { _, ok := p.on[s]; return ok }
func (p phones) Enabled(s string) bool { return p.on[s] }

// fakeUV records its argv and env; `run …` prints lines and sleeps $FAKE_SLEEP.
const fakeUV = `#!/bin/bash
echo "$*" >> "$FAKE_LOG"
env | grep -E '^(OPENAI_API_KEY|ADB_DEVICE_SERIAL|ARTEMIS_STANDALONE|UV_TOOL_DIR)=' | sort >> "$FAKE_LOG"
case "$1" in
  tool) mkdir -p "$UV_TOOL_BIN_DIR"; cp "$0.mobilerun" "$UV_TOOL_BIN_DIR/mobilerun"; chmod +x "$UV_TOOL_BIN_DIR/mobilerun" ;;
  run) echo "step 1: opening settings"; sleep "${FAKE_SLEEP:-0}"; echo "done" ;;
esac
`

const fakeMobilerun = `#!/bin/bash
echo "mobilerun $*" >> "$FAKE_LOG"
case "$1" in
  setup) echo "portal installed" ;;
  run) echo "working"; sleep "${FAKE_SLEEP:-0}"; exit "${FAKE_EXIT:-0}" ;;
esac
`

func tarGz(t *testing.T, files map[string]string) []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		_, _ = tw.Write([]byte(body))
	}
	_ = tw.Close()
	_ = gz.Close()
	return buf.Bytes()
}

type events struct {
	mu  sync.Mutex
	all []wire.Event
}

func (e *events) add(f any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.all = append(e.all, f.(wire.Event))
}

func (e *events) states(runID string) []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []string
	for _, ev := range e.all {
		d := ev.Data.(map[string]string)
		if d["run_id"] == runID {
			out = append(out, d["state"])
		}
	}
	return out
}

func setup(t *testing.T) (*Host, *events, string) {
	t.Helper()
	dir := t.TempDir()
	log := filepath.Join(dir, "calls.log")
	uv := filepath.Join(dir, "uv")
	_ = os.WriteFile(uv, []byte(fakeUV), 0o755)
	_ = os.WriteFile(uv+".mobilerun", []byte(fakeMobilerun), 0o755)
	ev := &events{}
	extra := []string{"FAKE_LOG=" + log}
	if v := os.Getenv("FAKE_SLEEP"); v != "" {
		extra = append(extra, "FAKE_SLEEP="+v)
	}
	h := &Host{
		ExtraEnv: extra,
		Root:     filepath.Join(dir, "addons"), StateDir: dir, UV: uv, Emit: ev.add,
		Phones: phones{on: map[string]bool{"S1": true, "S2": false}},
		Fetch: func(_ context.Context, url, dest string) error {
			switch {
			case strings.Contains(url, "api.github.com"):
				return os.WriteFile(dest, []byte("351ca8422f7b5b54e80a9c1ce03a222e02415b6b\n"), 0o600)
			case strings.Contains(url, "codeload.github.com/google/artemis/tar.gz/351ca8422f7b"):
				return os.WriteFile(dest, tarGz(t, map[string]string{"artemis-x/pyproject.toml": "[project]\n"}), 0o600)
			}
			return errors.New("unexpected url " + url)
		},
	}
	return h, ev, log
}

func call(t *testing.T, h *Host, verb string, args any) (any, error) {
	raw, _ := json.Marshal(args)
	return h.Handle(context.Background(), verb, raw)
}

func code(err error) string {
	var ve *wire.VerbError
	if errors.As(err, &ve) {
		return ve.Code
	}
	return "?"
}

func waitState(t *testing.T, ev *events, runID, want string) {
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		states := ev.states(runID)
		if len(states) > 0 && states[len(states)-1] == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run %s states %v, want final %s", runID, ev.states(runID), want)
}

func TestInstallArtemisPinsTheCommitAndRemoveFreesDisk(t *testing.T) {
	h, _, log := setup(t)
	_ = os.MkdirAll(filepath.Join(h.StateDir, "python", "cpython"), 0o700)
	res, err := call(t, h, "addon_install", map[string]string{"name": "artemis"})
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]string)["version"] != "351ca8422f7b" {
		t.Fatalf("version %v", res)
	}
	inv := h.Installed()
	if len(inv) != 1 || inv[0].Name != "artemis" || *inv[0].DiskBytes == 0 {
		t.Fatalf("installed %+v", inv)
	}
	calls, _ := os.ReadFile(log)
	if !strings.Contains(string(calls), "sync --project "+filepath.Join(h.Root, "artemis", "src")) {
		t.Fatalf("uv calls %s", calls)
	}
	if _, err := call(t, h, "addon_remove", map[string]string{"name": "artemis"}); err != nil {
		t.Fatal(err)
	}
	if len(h.Installed()) != 0 {
		t.Fatal("still installed after remove")
	}
	for _, left := range []string{filepath.Join(h.Root, "artemis"), filepath.Join(h.StateDir, "python"), filepath.Join(h.StateDir, "uv-cache")} {
		if _, err := os.Stat(left); !os.IsNotExist(err) {
			t.Fatalf("%s left behind", left)
		}
	}
}

func TestRunChecksSwitchArgsAndReportsProgress(t *testing.T) {
	h, ev, log := setup(t)
	if _, err := call(t, h, "addon_run", map[string]any{"name": "artemis", "task": "x", "device": "S1", "max_minutes": 5}); code(err) != wire.ErrRefused {
		t.Fatalf("not installed: %v", err)
	}
	if _, err := call(t, h, "addon_install", map[string]string{"name": "artemis"}); err != nil {
		t.Fatal(err)
	}
	if err := h.SetKey("artemis", "OPENAI_API_KEY", "sk-test"); err != nil {
		t.Fatal(err)
	}
	if info, _ := os.Stat(filepath.Join(h.Root, "artemis", envName)); info.Mode().Perm() != 0o600 {
		t.Fatalf("keys mode %v", info.Mode().Perm())
	}
	for _, tc := range []struct {
		args map[string]any
		want string
	}{
		{map[string]any{"name": "artemis", "task": "x", "device": "S2", "max_minutes": 5}, wire.ErrSwitchOff},
		{map[string]any{"name": "artemis", "task": "x", "device": "S9", "max_minutes": 5}, wire.ErrUnknownDevice},
		{map[string]any{"name": "artemis", "task": "x", "device": "S1", "max_minutes": 0}, wire.ErrBadArgs},
		{map[string]any{"name": "artemis", "task": " ", "device": "S1", "max_minutes": 5}, wire.ErrBadArgs},
	} {
		if _, err := call(t, h, "addon_run", tc.args); code(err) != tc.want {
			t.Errorf("%v: %v", tc.args, err)
		}
	}
	res, err := call(t, h, "addon_run", map[string]any{"name": "artemis", "task": "Open Settings", "device": "S1", "max_minutes": 5})
	if err != nil {
		t.Fatal(err)
	}
	runID := res.(map[string]string)["run_id"]
	waitState(t, ev, runID, "done")
	calls, _ := os.ReadFile(log)
	for _, want := range []string{"run --project", "artemis run Open Settings --device-serial S1", "ADB_DEVICE_SERIAL=S1", "ARTEMIS_STANDALONE=1", "OPENAI_API_KEY=sk-test"} {
		if !strings.Contains(string(calls), want) {
			t.Errorf("missing %q in %s", want, calls)
		}
	}
	if h.KeyNames("artemis")[0] != "OPENAI_API_KEY" {
		t.Fatal("key names")
	}
}

func TestStopAndTimeoutKillTheRun(t *testing.T) {
	t.Setenv("FAKE_SLEEP", "30")
	h, ev, log := setup(t)
	if _, err := call(t, h, "addon_install", map[string]string{"name": "mobilerun"}); err != nil {
		t.Fatal(err)
	}
	id, err := h.start(Mobilerun, "Turn on dark mode", "S1", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.start(Mobilerun, "again", "S1", time.Minute); code(err) != wire.ErrBusy {
		t.Fatalf("second run on the same phone: %v", err)
	}
	if _, err := call(t, h, "addon_remove", map[string]string{"name": "mobilerun"}); code(err) != wire.ErrBusy {
		t.Fatalf("remove while running: %v", err)
	}
	time.Sleep(200 * time.Millisecond)
	h.StopDevice("S1")
	waitState(t, ev, id, "stopped")
	calls, _ := os.ReadFile(log)
	if !strings.Contains(string(calls), "mobilerun setup --device S1") || strings.Count(string(calls), "mobilerun setup") != 1 {
		t.Fatalf("setup calls %s", calls)
	}
	id2, err := h.start(Mobilerun, "slow", "S1", 300*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	waitState(t, ev, id2, "failed")
	calls, _ = os.ReadFile(log)
	if strings.Count(string(calls), "mobilerun setup") != 1 {
		t.Fatal("setup ran twice for the same phone")
	}
}
