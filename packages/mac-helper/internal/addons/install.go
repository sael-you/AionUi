package addons

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

var httpClient = &http.Client{Timeout: 15 * time.Minute}

// PythonVersion is the managed Python both add-ons run on (Artemis needs
// ≥ 3.12, Mobilerun < 3.14; newer Pythons lack wheels some deps need).
const PythonVersion = "3.12"

var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

// download is the default Fetch: GET url into dest (https only).
func download(ctx context.Context, url, dest string) error {
	if !strings.HasPrefix(url, "https://") {
		return fmt.Errorf("refusing non-https download %s", url)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if strings.HasPrefix(url, "https://api.github.com/") && strings.HasSuffix(url, "?format=sha") {
		req.URL.RawQuery = ""
		req.Header.Set("Accept", "application/vnd.github.sha")
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: HTTP %d", url, resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, io.LimitReader(resp.Body, 1<<30)); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func (h *Host) fetch(ctx context.Context, url, dest string) error {
	if h.Fetch != nil {
		return h.Fetch(ctx, url, dest)
	}
	return download(ctx, url, dest)
}

// uvAsset names astral-sh/uv's release asset for this Mac.
func uvAsset() string {
	arch := "aarch64"
	if runtime.GOARCH == "amd64" {
		arch = "x86_64"
	}
	if runtime.GOOS == "linux" {
		return "uv-" + arch + "-unknown-linux-gnu.tar.gz"
	}
	return "uv-" + arch + "-apple-darwin.tar.gz"
}

// ensureUV returns uv: the override, the helper's own copy, or a fresh
// download from astral-sh/uv's latest release checked against its .sha256.
func (h *Host) ensureUV(ctx context.Context) (string, error) {
	if h.UV != "" {
		return h.UV, nil
	}
	bin := filepath.Join(h.StateDir, "uv", "uv")
	if _, err := os.Stat(bin); err == nil {
		return bin, nil
	}
	if err := os.MkdirAll(filepath.Dir(bin), 0o700); err != nil {
		return "", err
	}
	asset := uvAsset()
	base := "https://github.com/astral-sh/uv/releases/latest/download/" + asset
	sumFile := filepath.Join(h.StateDir, "uv", asset+".sha256")
	tarFile := filepath.Join(h.StateDir, "uv", asset)
	defer os.Remove(sumFile)
	defer os.Remove(tarFile)
	if err := h.fetch(ctx, base+".sha256", sumFile); err != nil {
		return "", fmtErr("uv checksum", err)
	}
	if err := h.fetch(ctx, base, tarFile); err != nil {
		return "", fmtErr("uv download", err)
	}
	want, _ := os.ReadFile(sumFile)
	fields := strings.Fields(string(want))
	if len(fields) == 0 || !strings.EqualFold(fields[0], fileSHA256(tarFile)) {
		return "", fmt.Errorf("uv download does not match its published sha256: not installed")
	}
	if err := extractTarGz(tarFile, filepath.Dir(bin), true); err != nil {
		return "", err
	}
	if _, err := os.Stat(bin); err != nil {
		return "", fmt.Errorf("uv binary missing from %s", asset)
	}
	return bin, nil
}

func fileSHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	_, _ = io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil))
}

// extractTarGz unpacks regular files (strip = drop the top-level folder),
// refusing links and paths that leave dest.
func extractTarGz(path, dest string, strip bool) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	root, _ := filepath.Abs(dest)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := hdr.Name
		if strip {
			if i := strings.Index(name, "/"); i >= 0 {
				name = name[i+1:]
			} else {
				continue
			}
		}
		if name == "" {
			continue
		}
		target := filepath.Join(root, name)
		if target != root && !strings.HasPrefix(target, root+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes the target: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if hdr.Mode&0o111 != 0 {
				mode = 0o755
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, io.LimitReader(tr, 512<<20)); err != nil {
				out.Close()
				return err
			}
			if err := out.Close(); err != nil {
				return err
			}
		case tar.TypeSymlink, tar.TypeLink:
			// Source trees may carry links; they are skipped, never followed.
			continue
		}
	}
}

// uvEnv keeps uv, Python and caches inside the helper's state dir.
func (h *Host) uvEnv(name string) []string {
	return append([]string{
		"PATH=" + h.path(),
		"HOME=" + os.Getenv("HOME"),
		"UV_PYTHON_INSTALL_DIR=" + filepath.Join(h.StateDir, "python"),
		"UV_CACHE_DIR=" + filepath.Join(h.StateDir, "uv-cache"),
		"UV_TOOL_DIR=" + filepath.Join(h.dir(name), "tools"),
		"UV_TOOL_BIN_DIR=" + filepath.Join(h.dir(name), "bin"),
		"UV_NO_MODIFY_PATH=1",
	}, h.ExtraEnv...)
}

func (h *Host) path() string {
	parts := []string{}
	if h.ADBDir != "" {
		parts = append(parts, h.ADBDir)
	}
	return strings.Join(append(parts, "/usr/bin", "/bin", "/usr/sbin", "/sbin"), ":")
}

func (h *Host) runUV(ctx context.Context, uv, name, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, uv, args...)
	cmd.Env = h.uvEnv(name)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		tail := strings.TrimSpace(string(out))
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		return fmt.Errorf("uv %s: %v: %s", args[0], err, tail)
	}
	return nil
}

// install puts an add-on into <root>/<name>, replacing an older copy only
// after the new one is ready.
func (h *Host) install(ctx context.Context, name, version string) (string, error) {
	if h.busy(name) {
		return "", fmt.Errorf("%s is running a task", name)
	}
	uv, err := h.ensureUV(ctx)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(h.Root, 0o700); err != nil {
		return "", err
	}
	// The download cache is only needed while installing; a failed install
	// leaves nothing behind either.
	defer h.freeShared()
	final := h.dir(name)
	staging := final + ".new"
	_ = os.RemoveAll(staging)
	defer os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o700); err != nil {
		return "", err
	}
	ictx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	installed := version
	switch name {
	case Artemis:
		// Pinned source of google/artemis (not on PyPI): a commit tarball.
		ref := version
		if ref == "" {
			ref = "main"
		}
		// Resolve the ref to a commit so the install is reproducible.
		shaFile := filepath.Join(staging, "commit")
		if err := h.fetch(ictx, "https://api.github.com/repos/google/artemis/commits/"+ref+"?format=sha", shaFile); err != nil {
			return "", fmtErr("artemis version", err)
		}
		shaRaw, _ := os.ReadFile(shaFile)
		_ = os.Remove(shaFile)
		sha := strings.TrimSpace(string(shaRaw))
		if !commitPattern.MatchString(sha) {
			return "", fmt.Errorf("artemis: %q is not a known version", ref)
		}
		ref = sha
		tarball := filepath.Join(staging, "src.tar.gz")
		if err := h.fetch(ictx, "https://codeload.github.com/google/artemis/tar.gz/"+ref, tarball); err != nil {
			return "", fmtErr("artemis download", err)
		}
		src := filepath.Join(staging, "src")
		if err := extractTarGz(tarball, src, true); err != nil {
			return "", err
		}
		_ = os.Remove(tarball)
		// The project must sync where it will live: install in place.
		if err := h.swap(staging, final); err != nil {
			return "", err
		}
		if err := h.runUV(ictx, uv, name, filepath.Join(final, "src"), "sync", "--python", PythonVersion, "--project", filepath.Join(final, "src")); err != nil {
			_ = os.RemoveAll(final)
			return "", err
		}
		installed = ref[:12]
	case Mobilerun:
		spec := "mobilerun[anthropic]"
		if version != "" {
			spec += "==" + version
		}
		if err := h.swap(staging, final); err != nil {
			return "", err
		}
		if err := h.runUV(ictx, uv, name, final, "tool", "install", "--force", "--python", PythonVersion, spec); err != nil {
			_ = os.RemoveAll(final)
			return "", err
		}
		if installed == "" {
			installed = "latest"
		}
	}
	m := manifest{Name: name, Version: installed, InstalledAt: time.Now().UTC()}
	raw, _ := json.Marshal(m)
	if err := os.WriteFile(h.manifestPath(name), raw, 0o600); err != nil {
		return "", err
	}
	return installed, nil
}

// swap replaces final with staging, keeping a preserved env file (keys).
func (h *Host) swap(staging, final string) error {
	envFile := filepath.Join(final, envName)
	if raw, err := os.ReadFile(envFile); err == nil {
		if err := os.WriteFile(filepath.Join(staging, envName), raw, 0o600); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(final); err != nil {
		return err
	}
	return os.Rename(staging, final)
}

// freeShared drops the uv download cache, and uv + Python when no add-on
// remains.
func (h *Host) freeShared() {
	_ = os.RemoveAll(filepath.Join(h.StateDir, "uv-cache"))
	if len(h.Installed()) == 0 {
		_ = os.RemoveAll(filepath.Join(h.StateDir, "python"))
		if h.UV == "" {
			_ = os.RemoveAll(filepath.Join(h.StateDir, "uv"))
		}
	}
}
