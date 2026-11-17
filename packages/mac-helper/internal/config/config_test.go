package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeServer(t *testing.T) {
	ok := map[string]string{
		"https://y.talkseeds.com":  "https://y.talkseeds.com",
		"https://y.talkseeds.com/": "https://y.talkseeds.com",
		" http://localhost:25809 ": "http://localhost:25809",
		"http://127.0.0.1:8080":    "http://127.0.0.1:8080",
	}
	for in, want := range ok {
		got, err := NormalizeServer(in)
		if err != nil || got != want {
			t.Errorf("NormalizeServer(%q) = %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{
		"http://y.talkseeds.com", "ftp://x.com", "https://u:p@x.com", "https://x.com/api", "https://x.com?a=1", "x.com",
	} {
		if _, err := NormalizeServer(bad); err == nil {
			t.Errorf("NormalizeServer(%q) accepted", bad)
		}
	}
}

func TestSaveLoadTokenAndModes(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "state")
	t.Setenv(DirEnv, dir)
	cfg, err := Load()
	if err != nil || cfg.Paired() || len(cfg.Enabled) != 0 {
		t.Fatalf("fresh config: %+v %v", cfg, err)
	}
	cfg.Server, cfg.DeviceID = "https://x.com", "dev1"
	cfg.Enabled["R5CT1"] = true
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	if err := SaveToken("secret-token"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{configFile, tokenFile} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Errorf("%s mode %v err %v", name, info.Mode().Perm(), err)
		}
	}
	if info, _ := os.Stat(dir); info.Mode().Perm() != 0o700 {
		t.Errorf("dir mode %v", info.Mode().Perm())
	}
	raw, _ := os.ReadFile(filepath.Join(dir, configFile))
	if string(raw) == "" || strings.Contains(string(raw), "secret-token") {
		t.Fatal("token leaked into config.json")
	}
	loaded, err := Load()
	if err != nil || !loaded.Paired() || !loaded.DeviceEnabled("R5CT1") || loaded.DeviceEnabled("other") {
		t.Fatalf("loaded: %+v %v", loaded, err)
	}
	loaded.Paused = true
	if loaded.DeviceEnabled("R5CT1") {
		t.Fatal("paused must switch every device off")
	}
	if err := Forget(); err != nil {
		t.Fatal(err)
	}
	after, _ := Load()
	if after.Paired() || after.DeviceEnabled("R5CT1") {
		t.Fatalf("after forget: %+v", after)
	}
}

func TestAddonSwitchDefaultsOffAndStopAllWins(t *testing.T) {
	c := &Config{}
	if c.AddonAllowed("artemis") {
		t.Fatal("default must be off")
	}
	c.Addons = map[string]bool{"artemis": true}
	if !c.AddonAllowed("artemis") || c.AddonAllowed("mobilerun") {
		t.Fatal("per add-on switch")
	}
	c.Paused = true
	if c.AddonAllowed("artemis") {
		t.Fatal("stop-all must win")
	}
}
