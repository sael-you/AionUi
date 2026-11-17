package addons

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
  venv) mkdir -p "${@: -1}/bin" ;;
  pip) py="$4"; bin="$(dirname "$py")"; cp "$0.mobilerun" "$bin/mobilerun"; chmod +x "$bin/mobilerun" ;;
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

// artemisFixture stands in for the pinned tarball; tests pin its sha256.
var artemisFixture = func() []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range map[string]string{"artemis-x/pyproject.toml": "[project]\n", "artemis-x/uv.lock": "version = 1\n"} {
		_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		_, _ = tw.Write([]byte(body))
	}
	_ = tw.Close()
	_ = gz.Close()
	return buf.Bytes()
}()

func setup(t *testing.T) (*Host, *events, string) {
	t.Helper()
	sum := sha256.Sum256(artemisFixture)
	old := artemisTarballSHA256
	artemisTarballSHA256 = hex.EncodeToString(sum[:])
	t.Cleanup(func() { artemisTarballSHA256 = old })
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
			case url == "https://codeload.github.com/google/artemis/tar.gz/"+ArtemisCommit:
				return os.WriteFile(dest, artemisFixture, 0o600)
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
	if res.(map[string]string)["version"] != PinnedVersion(Artemis) {
		t.Fatalf("version %v", res)
	}
	inv := h.Installed()
	if len(inv) != 1 || inv[0].Name != "artemis" || *inv[0].DiskBytes == 0 {
		t.Fatalf("installed %+v", inv)
	}
	calls, _ := os.ReadFile(log)
	if !strings.Contains(string(calls), "sync --frozen --python 3.12 --project "+filepath.Join(h.Root, "artemis", "src")) {
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
	for _, want := range []string{"run --frozen --no-sync --project", "artemis run --device-serial S1 --standalone -- Open Settings", "ADB_DEVICE_SERIAL=S1", "ARTEMIS_STANDALONE=1", "OPENAI_API_KEY=sk-test"} {
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

func TestOnlyThePinnedVersionInstalls(t *testing.T) {
	h, _, log := setup(t)
	if _, err := call(t, h, "addon_install", map[string]string{"name": "artemis", "version": "main"}); code(err) != wire.ErrRefused {
		t.Fatalf("free ref: %v", err)
	}
	if _, err := call(t, h, "addon_install", map[string]string{"name": "mobilerun", "version": "9.9.9"}); code(err) != wire.ErrRefused {
		t.Fatalf("other version: %v", err)
	}
	if calls, _ := os.ReadFile(log); len(calls) != 0 {
		t.Fatalf("something ran: %s", calls)
	}
	if _, err := call(t, h, "addon_install", map[string]string{"name": "mobilerun", "version": MobilerunVersion}); err != nil {
		t.Fatal(err)
	}
	calls, _ := os.ReadFile(log)
	for _, want := range []string{"--require-hashes", "--only-binary :all:", "--no-binary apkutils2", "--build-constraints", "requirements.txt"} {
		if !strings.Contains(string(calls), want) {
			t.Errorf("pip install misses %q: %s", want, calls)
		}
	}
	req, _ := os.ReadFile(filepath.Join(h.Root, "mobilerun", "requirements.txt"))
	if !strings.Contains(string(req), "mobilerun==0.7.4") || !strings.Contains(string(req), "--hash=sha256:") {
		t.Fatal("pinned requirements not used")
	}
}

func TestATamperedArtemisTarballIsRefused(t *testing.T) {
	h, _, log := setup(t)
	artemisTarballSHA256 = strings.Repeat("0", 64)
	if _, err := call(t, h, "addon_install", map[string]string{"name": "artemis"}); err == nil || !strings.Contains(err.Error(), "pinned sha256") {
		t.Fatalf("tampered tarball: %v", err)
	}
	if calls, _ := os.ReadFile(log); strings.Contains(string(calls), "sync") {
		t.Fatal("uv sync ran on an unverified tarball")
	}
	if len(h.Installed()) != 0 {
		t.Fatal("installed anyway")
	}
}

func TestTasksAreNeverOptions(t *testing.T) {
	h, _, _ := setup(t)
	if _, err := call(t, h, "addon_install", map[string]string{"name": "artemis"}); err != nil {
		t.Fatal(err)
	}
	for _, task := range []string{"--help", "-x", "  --profile pro"} {
		if _, err := call(t, h, "addon_run", map[string]any{"name": "artemis", "task": task, "device": "S1", "max_minutes": 5}); code(err) != wire.ErrBadArgs {
			t.Errorf("task %q: %v", task, err)
		}
	}
}

func TestAddonEnvNeverCarriesHelperVariables(t *testing.T) {
	h, _, _ := setup(t)
	for _, name := range []string{"AIONUI_DEVICE_TOKEN", "PATH", "HOME", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "UV_INDEX_URL", "PYTHONPATH", "ADB_SERVER_SOCKET"} {
		if err := h.SetKey("artemis", name, "x"); err == nil {
			t.Errorf("key %s accepted", name)
		}
	}
	got := scrubEnv([]string{"PATH=/usr/bin", "AIONUI_MAC_HELPER_DIR=/state", "AIONUI_TOKEN=secret", "OPENAI_API_KEY=k"})
	if strings.Join(got, " ") != "PATH=/usr/bin OPENAI_API_KEY=k" {
		t.Fatalf("scrubbed env: %v", got)
	}
	h.ExtraEnv = append(h.ExtraEnv, "AIONUI_TOKEN=secret")
	if _, err := call(t, h, "addon_install", map[string]string{"name": "mobilerun"}); err != nil {
		t.Fatal(err)
	}
	_, _, env, err := h.command(Mobilerun, "task", "S1")
	if err != nil {
		t.Fatal(err)
	}
	for _, kv := range env {
		if strings.HasPrefix(kv, "AIONUI") {
			t.Fatalf("helper variable reached the add-on: %s", kv)
		}
	}
}

func TestArchiveLinksAreNeverFollowed(t *testing.T) {
	dir := t.TempDir()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	_ = tw.WriteHeader(&tar.Header{Name: "top/link", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"})
	_ = tw.WriteHeader(&tar.Header{Name: "top/hard", Typeflag: tar.TypeLink, Linkname: "/etc/hostname"})
	_ = tw.WriteHeader(&tar.Header{Name: "top/ok.txt", Mode: 0o644, Size: 2, Typeflag: tar.TypeReg})
	_, _ = tw.Write([]byte("ok"))
	_ = tw.Close()
	_ = gz.Close()
	archive := filepath.Join(dir, "a.tar.gz")
	_ = os.WriteFile(archive, buf.Bytes(), 0o600)
	out := filepath.Join(dir, "out")
	if err := extractTarGz(archive, out, true); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"link", "hard"} {
		if _, err := os.Lstat(filepath.Join(out, name)); !os.IsNotExist(err) {
			t.Errorf("%s was created", name)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(out, "ok.txt")); string(b) != "ok" {
		t.Fatal("regular file missing")
	}
}
