// Package config holds the helper's on-disk state: the server it is paired
// with, the device token (a secret: file mode 0600, never logged), and the
// owner's local switches per device.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// DirEnv overrides the state directory (tests, a second profile).
const DirEnv = "AIONUI_MAC_HELPER_DIR"

const (
	configFile = "config.json"
	tokenFile  = "device-token"
)

// Config is the non-secret state. The token lives in its own 0600 file so a
// config dump or a bug report never carries it.
type Config struct {
	// Server is the AionUi origin, e.g. https://y.talkseeds.com.
	Server string `json:"server"`
	// DeviceID is the id AionUi gave this helper at pairing.
	DeviceID string `json:"device_id"`
	// Enabled lists the device keys (phone serials, "mac") the owner allows
	// agents to use from this Mac. Default: none.
	Enabled map[string]bool `json:"enabled"`
	// Paused stops every device at once until cleared ("Stop all").
	Paused bool `json:"paused"`
}

// Dir is the state directory: $AIONUI_MAC_HELPER_DIR, else
// ~/Library/Application Support/AionUi Mac Helper on macOS and
// $XDG_CONFIG_HOME/aionui-mac-helper elsewhere (Linux CI).
func Dir() (string, error) {
	if dir := os.Getenv(DirEnv); dir != "" {
		return dir, nil
	}
	if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "AionUi Mac Helper"), nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "aionui-mac-helper"), nil
}

func ensureDir() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	// MkdirAll keeps an existing directory's mode: tighten it.
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

// Load reads the config; a missing file is an empty, unpaired config.
func Load() (*Config, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	cfg := &Config{Enabled: map[string]bool{}}
	raw, err := os.ReadFile(filepath.Join(dir, configFile))
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, cfg); err != nil {
		return nil, fmt.Errorf("config.json: %w", err)
	}
	if cfg.Enabled == nil {
		cfg.Enabled = map[string]bool{}
	}
	return cfg, nil
}

// Save writes the config atomically (temp file + rename), mode 0600.
func (c *Config) Save() error {
	dir, err := ensureDir()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(dir, configFile), append(raw, '\n'))
}

// DeviceEnabled reports the owner's local switch for one device key.
func (c *Config) DeviceEnabled(key string) bool {
	return !c.Paused && c.Enabled[key]
}

// Paired reports whether pairing completed (server, id and a token).
func (c *Config) Paired() bool {
	if c.Server == "" || c.DeviceID == "" {
		return false
	}
	token, err := LoadToken()
	return err == nil && token != ""
}

// NormalizeServer accepts an AionUi origin. https is required except for a
// loopback host (local development), mirroring the extension (TASK-125).
func NormalizeServer(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("not a URL: %q", raw)
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", fmt.Errorf("use the bare AionUi origin, e.g. https://example.com")
	}
	host := u.Hostname()
	loopback := host == "localhost" || host == "127.0.0.1" || host == "::1"
	switch {
	case u.Scheme == "https":
	case u.Scheme == "http" && loopback:
	default:
		return "", fmt.Errorf("https is required (http only for localhost)")
	}
	return u.Scheme + "://" + u.Host, nil
}

// LoadToken returns the device token, or "" when there is none.
func LoadToken() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, tokenFile))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}

// SaveToken stores the device token with mode 0600.
func SaveToken(token string) error {
	dir, err := ensureDir()
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(dir, tokenFile), []byte(token+"\n"))
}

// Forget removes the token and the pairing (switches are kept off).
func Forget() error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dir, tokenFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	cfg, err := Load()
	if err != nil {
		return err
	}
	cfg.Server, cfg.DeviceID, cfg.Enabled = "", "", map[string]bool{}
	return cfg.Save()
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
