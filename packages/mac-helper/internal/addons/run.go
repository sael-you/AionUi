package addons

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

type run struct {
	id, name, device string
	cancel           context.CancelFunc
	stopped          bool
}

const envName = "keys.env"

// progressEvery throttles addon_progress while a run prints.
var progressEvery = 2 * time.Second

var envKey = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,63}$`)

// SetKey stores one environment value for an add-on (an API key) in its
// 0600 keys.env. Values never leave the Mac and are never logged.
func (h *Host) SetKey(name, key, value string) error {
	if !known(name) {
		return fmt.Errorf("unknown add-on %q", name)
	}
	if !envKey.MatchString(key) || strings.ContainsAny(value, "\r\n") {
		return fmt.Errorf("invalid key name or value")
	}
	if err := os.MkdirAll(h.dir(name), 0o700); err != nil {
		return err
	}
	vals := h.keys(name)
	if value == "" {
		delete(vals, key)
	} else {
		vals[key] = value
	}
	var b strings.Builder
	for k, v := range vals {
		b.WriteString(k + "=" + v + "\n")
	}
	return os.WriteFile(filepath.Join(h.dir(name), envName), []byte(b.String()), 0o600)
}

// KeyNames lists the stored key names (never values).
func (h *Host) KeyNames(name string) []string {
	var names []string
	for k := range h.keys(name) {
		names = append(names, k)
	}
	return names
}

func (h *Host) keys(name string) map[string]string {
	vals := map[string]string{}
	raw, err := os.ReadFile(filepath.Join(h.dir(name), envName))
	if err != nil {
		return vals
	}
	for _, line := range strings.Split(string(raw), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if ok && envKey.MatchString(k) {
			vals[k] = v
		}
	}
	return vals
}

func newRunID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "run-" + hex.EncodeToString(b)
}

func (h *Host) busy(name string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.runs {
		if r.name == name {
			return true
		}
	}
	return false
}

// command builds the add-on's argv for one task.
func (h *Host) command(name, task, device string) (string, []string, []string, error) {
	uv, err := h.ensureUV(context.Background())
	if err != nil {
		return "", nil, nil, err
	}
	env := h.uvEnv(name)
	for k, v := range h.keys(name) {
		env = append(env, k+"="+v)
	}
	switch name {
	case Artemis:
		src := filepath.Join(h.dir(name), "src")
		// Standalone: no Artemis daemon / web console listening on the Mac.
		env = append(env, "ARTEMIS_STANDALONE=1", "ADB_DEVICE_SERIAL="+device)
		return uv, []string{"run", "--project", src, "artemis", "run", task, "--device-serial", device, "--standalone"}, env, nil
	case Mobilerun:
		bin := filepath.Join(h.dir(name), "bin", "mobilerun")
		return bin, []string{"run", task, "--device", device}, env, nil
	}
	return "", nil, nil, fmt.Errorf("unknown add-on %q", name)
}

// start launches a run in its own process group and reports progress.
func (h *Host) start(name, task, device string, limit time.Duration) (string, error) {
	h.mu.Lock()
	if h.runs == nil {
		h.runs = map[string]*run{}
	}
	for _, r := range h.runs {
		if r.device == device {
			h.mu.Unlock()
			return "", wire.Errorf(wire.ErrBusy, "an add-on task is already running on %s", device)
		}
	}
	h.mu.Unlock()
	bin, args, env, err := h.command(name, task, device)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	if name == Mobilerun && !h.setUp(device) {
		// First Mobilerun task on this phone: `mobilerun setup` installs its
		// Portal app (AGPL-3.0, from upstream) on the phone, once.
		setup := exec.CommandContext(ctx, bin, "setup", "--device", device)
		setup.Env, setup.Dir = env, h.dir(name)
		if out, err := setup.CombinedOutput(); err != nil {
			cancel()
			return "", fmt.Errorf("mobilerun setup: %v: %s", err, trimLine(lastLine(string(out))))
		}
		h.markSetUp(device)
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = env
	cmd.Dir = h.dir(name)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		// The whole group: uv → python → adb children.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		return nil
	}
	cmd.WaitDelay = 5 * time.Second
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	if err := cmd.Start(); err != nil {
		cancel()
		return "", err
	}
	r := &run{id: newRunID(), name: name, device: device, cancel: cancel}
	h.mu.Lock()
	h.runs[r.id] = r
	h.mu.Unlock()
	h.progress(device, r.id, "running", "")
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		last := time.Time{}
		for sc.Scan() {
			line := trimLine(sc.Text())
			if line != "" && time.Since(last) >= progressEvery {
				last = time.Now()
				h.progress(device, r.id, "running", line)
			}
		}
		_, _ = io.Copy(io.Discard, pr)
	}()
	go func() {
		err := cmd.Wait()
		// Make sure nothing of the group survives.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		pw.Close()
		wg.Wait()
		h.mu.Lock()
		stopped := r.stopped
		delete(h.runs, r.id)
		h.mu.Unlock()
		state, msg := "done", ""
		switch {
		case stopped:
			state = "stopped"
		case ctx.Err() == context.DeadlineExceeded:
			state, msg = "failed", "max_minutes reached"
		case err != nil:
			state, msg = "failed", err.Error()
		}
		cancel()
		h.progress(device, r.id, state, msg)
	}()
	return r.id, nil
}

func (h *Host) setupFile(device string) string {
	return filepath.Join(h.dir(Mobilerun), "setup-"+hex.EncodeToString([]byte(device)))
}

func (h *Host) setUp(device string) bool {
	_, err := os.Stat(h.setupFile(device))
	return err == nil
}

func (h *Host) markSetUp(device string) { _ = os.WriteFile(h.setupFile(device), nil, 0o600) }

func lastLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "\n"); i >= 0 {
		return s[i+1:]
	}
	return s
}

func (h *Host) stop(id string) bool {
	h.mu.Lock()
	r, ok := h.runs[id]
	if ok {
		r.stopped = true
	}
	h.mu.Unlock()
	if ok {
		r.cancel()
	}
	return ok
}

// StopDevice implements agent.Addons: stop / switch off / phone unplugged.
func (h *Host) StopDevice(serial string) {
	h.mu.Lock()
	var ids []string
	for id, r := range h.runs {
		if r.device == serial {
			ids = append(ids, id)
		}
	}
	h.mu.Unlock()
	for _, id := range ids {
		h.stop(id)
	}
}
