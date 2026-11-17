// Command aionui-mac-helper lets AionUi agents use the phones plugged into
// (or Wi-Fi-paired with) this Mac — and, when allowed, the Mac itself —
// through an outbound connection to AionUi (C38, TASK-136). Nothing listens
// on the Mac; every device stays off until the owner switches it on.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/adb"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/addons"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/agent"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/audit"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/cdp"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/config"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/macos"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/macos/control"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/relay"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// version is set at build time (-ldflags "-X main.version=…").
var version = "dev"

const usage = `aionui-mac-helper — lets AionUi agents use your phones (and this Mac) while you allow it.

  pair <aionui-url> <code> [--name NAME]   pair with AionUi (code from Settings → Devices)
  run                                      connect and serve (launchd runs this)
  status                                   pairing, phones and switches
  enable <serial|mac> / disable <serial|mac>   the local switch for one device (default off)
  stop-all / resume                        switch every device off now / undo
  install-adb --accept-android-sdk-license download Google's platform-tools (adb) into the helper's folder
  install-agent / uninstall-agent          start at login (launchd) / stop that
  logs [N]                                 last N lines of the local audit log (default 20)
  addons                                   installed add-ons (Artemis, Mobilerun), size, stored key names
  addon-install <artemis|mobilerun> [version] / addon-remove <name>   (AionUi can do this too)
  addon-key <name> <ENV_NAME>              store an API key for an add-on (typed, not echoed; empty = delete)
  forget                                   delete the pairing and token
  version
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err := runCommand(os.Args[1], os.Args[2:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func runCommand(cmd string, args []string) error {
	switch cmd {
	case "pair":
		return cmdPair(args)
	case "run":
		return cmdRun()
	case "status":
		return cmdStatus()
	case "enable", "disable":
		if len(args) != 1 {
			return fmt.Errorf("usage: %s <serial|mac>", cmd)
		}
		return setSwitch(args[0], cmd == "enable")
	case "stop-all", "resume":
		return setPaused(cmd == "stop-all")
	case "install-adb":
		return cmdInstallADB(args)
	case "install-agent":
		return cmdInstallAgent()
	case "uninstall-agent":
		return macos.UninstallAgent()
	case "logs":
		return cmdLogs(args)
	case "addons":
		return cmdAddons()
	case "addon-install", "addon-remove":
		return cmdAddonInstall(cmd, args)
	case "addon-key":
		return cmdAddonKey(args)
	case "forget":
		return config.Forget()
	case "version", "--version":
		fmt.Println(version)
		return nil
	case "help", "-h", "--help":
		fmt.Print(usage)
		return nil
	}
	return fmt.Errorf("unknown command %q (try help)", cmd)
}

// capabilities is what this build can do (sent in pair/hello).
func capabilities() []string {
	caps := []string{
		"screenshot", "ui_tree", "tap", "swipe", "text", "key", "launch", "foreground",
		"install_apk", "logcat", "stop", "cdp_open", "cdp_frame", "cdp_close",
	}
	caps = append(caps, "addon_install", "addon_remove", "addon_run", "addon_stop")
	if control.Supported() {
		caps = append(caps, "mac_screenshot", "mac_ax_tree", "mac_click", "mac_type", "mac_key", "mac_open_app")
	}
	return caps
}

func cmdPair(args []string) error {
	fs := flag.NewFlagSet("pair", flag.ContinueOnError)
	host, _ := os.Hostname()
	name := fs.String("name", strings.TrimSuffix(host, ".local"), "name shown in AionUi")
	positional := []string{}
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			return err
		}
		args = fs.Args()
		if len(args) > 0 {
			positional = append(positional, args[0])
			args = args[1:]
		}
	}
	if len(positional) != 2 {
		return errors.New("usage: pair <aionui-url> <code> [--name NAME]")
	}
	server, err := config.NormalizeServer(positional[0])
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	clientID, token, err := relay.Pair(ctx, server, strings.TrimSpace(positional[1]), *name, version, capabilities())
	if err != nil {
		return err
	}
	if err := config.SaveToken(token); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Server, cfg.DeviceID = server, clientID
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Printf("Paired with %s as %q. Every device is off until you run `aionui-mac-helper enable <serial>`.\n", server, *name)
	return nil
}

func stateDir() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return dir, os.MkdirAll(dir, 0o700)
}

func adbRunner() (adb.Runner, error) {
	dir, err := stateDir()
	if err != nil {
		return nil, err
	}
	bin, err := adb.Find(dir)
	if err != nil {
		return nil, err
	}
	return adb.Exec{Bin: bin}, nil
}

func cmdRun() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.Paired() {
		return errors.New("not paired: run `aionui-mac-helper pair <aionui-url> <code>` first")
	}
	token, err := config.LoadToken()
	if err != nil {
		return err
	}
	runner, err := adbRunner()
	if err != nil {
		return err
	}
	dir, _ := stateDir()
	log, err := audit.Open(dir)
	if err != nil {
		return err
	}
	a := agent.New(runner, log, cfg)
	a.Notify = macos.Notifier{}
	tunnels := cdp.NewManager(runner)
	a.CDP = tunnels
	if control.Supported() {
		a.Mac = control.New(dir)
	}
	host := addonHost(dir)
	host.Phones = a
	a.Addons = host
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go a.Run(ctx, filepath.Join(dir, "config.json"))
	client := &relay.Client{
		Server: cfg.Server, Token: token, Version: version, Caps: capabilities(), H: &emitAll{a, tunnels, host},
		OnState: func(connected bool, err error) {
			state := "disconnected"
			if connected {
				state = "connected"
			}
			e := audit.Entry{Verb: "relay_" + state, OK: connected}
			if err != nil {
				e.Error = err.Error()
			}
			log.Write(e)
			fmt.Fprintf(os.Stderr, "%s relay %s %v\n", time.Now().Format(time.RFC3339), state, errOrEmpty(err))
		},
	}
	err = client.Run(ctx)
	if errors.Is(err, relay.ErrRevoked) {
		macos.Notifier{}.Notify("AionUi Mac Helper", "AionUi revoked this Mac. Pair it again from Settings → Devices.")
	}
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

// emitAll hands the relay's emitter to the CDP layer as well.
type emitAll struct {
	*agent.Agent
	tunnels *cdp.Manager
	addons  *addons.Host
}

func (e *emitAll) SetEmitter(f func(any)) {
	e.Agent.SetEmitter(f)
	e.tunnels.SetEmit(f)
	e.addons.SetEmit(f)
}

// addonHost keeps add-ons, uv and Python inside the helper's state dir.
func addonHost(dir string) *addons.Host {
	h := &addons.Host{Root: filepath.Join(dir, "addons"), StateDir: dir}
	if bin, err := adb.Find(dir); err == nil {
		h.ADBDir = filepath.Dir(bin)
	}
	return h
}

func errOrEmpty(err error) any {
	if err == nil {
		return ""
	}
	return err
}

func cmdStatus() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Paired() {
		fmt.Printf("Paired with %s (device %s)\n", cfg.Server, cfg.DeviceID)
	} else {
		fmt.Println("Not paired.")
	}
	if cfg.Paused {
		fmt.Println("STOPPED: every device is off (run `resume`).")
	}
	dir, err := stateDir()
	if err != nil {
		return err
	}
	runner, err := adbRunner()
	if err != nil {
		fmt.Println("adb:", err)
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	phones, err := adb.Devices(ctx, runner)
	if err != nil {
		return err
	}
	if control.Supported() {
		mac := control.New(dir).Info()
		fmt.Printf("  %-28s %-12s %-5s %-14s agents %s (permissions %s)\n", "mac", "this Mac", "-", mac.Name,
			onOff(cfg.DeviceEnabled(wire.DeviceMac)), map[bool]string{true: "granted", false: "missing: Screen Recording + Accessibility"}[mac.PermissionsOK])
	}
	if len(phones) == 0 {
		fmt.Println("No phones: plug one in (USB debugging on) or pair one over Wi-Fi with `adb pair`.")
	}
	for _, p := range phones {
		fmt.Printf("  %-28s %-12s %-5s %-14s agents %s\n", p.Serial, p.State, p.Transport, p.Model, onOff(cfg.DeviceEnabled(p.Serial)))
	}
	return nil
}

func onOff(b bool) string {
	if b {
		return "ON"
	}
	return "off"
}

func setSwitch(key string, on bool) error {
	if key != wire.DeviceMac && strings.ContainsAny(key, " \t/") {
		return fmt.Errorf("not a device serial: %q", key)
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if on {
		cfg.Enabled[key] = true
	} else {
		delete(cfg.Enabled, key)
	}
	if err := cfg.Save(); err != nil {
		return err
	}
	fmt.Printf("%s: agents %s (AionUi's own switch must be on too)\n", key, onOff(on))
	return nil
}

func setPaused(paused bool) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Paused = paused
	if err := cfg.Save(); err != nil {
		return err
	}
	if paused {
		fmt.Println("Stopped: every device is off now.")
	} else {
		fmt.Println("Resumed: devices you enabled are available again.")
	}
	return nil
}

func cmdInstallADB(args []string) error {
	accepted := len(args) == 1 && args[0] == "--accept-android-sdk-license"
	if !accepted {
		return fmt.Errorf("platform-tools is Google's software under the Android SDK License (%s); "+
			"read it, then run `install-adb --accept-android-sdk-license`", adb.LicenseURL)
	}
	dir, err := stateDir()
	if err != nil {
		return err
	}
	host := "macosx"
	if runtime.GOOS == "linux" {
		host = "linux"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	v, err := adb.InstallPlatformTools(ctx, dir, host)
	if err != nil {
		return err
	}
	fmt.Printf("platform-tools %s installed in %s\n", v, filepath.Join(dir, "platform-tools"))
	return nil
}

func cmdInstallAgent() error {
	bin, err := os.Executable()
	if err != nil {
		return err
	}
	bin, _ = filepath.EvalSymlinks(bin)
	dir, err := stateDir()
	if err != nil {
		return err
	}
	path, err := macos.InstallAgent(bin, dir)
	if err != nil {
		return err
	}
	fmt.Println("Starts at login:", path)
	return nil
}

func cmdLogs(args []string) error {
	n := 20
	if len(args) == 1 {
		if _, err := fmt.Sscanf(args[0], "%d", &n); err != nil || n <= 0 {
			return errors.New("usage: logs [N]")
		}
	}
	dir, err := stateDir()
	if err != nil {
		return err
	}
	f, err := os.Open(filepath.Join(dir, "helper.jsonl"))
	if errors.Is(err, os.ErrNotExist) {
		fmt.Println("No log yet.")
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}
	for _, l := range lines {
		fmt.Println(l)
	}
	return sc.Err()
}

func cmdAddons() error {
	dir, err := stateDir()
	if err != nil {
		return err
	}
	h := addonHost(dir)
	installed := h.Installed()
	if len(installed) == 0 {
		fmt.Println("No add-ons installed.")
	}
	for _, a := range installed {
		fmt.Printf("  %-10s %-14s %6.1f MB  keys: %s\n", a.Name, *a.Version, float64(*a.DiskBytes)/1e6, strings.Join(h.KeyNames(a.Name), ", "))
	}
	return nil
}

func cmdAddonInstall(cmd string, args []string) error {
	if len(args) < 1 || len(args) > 2 || (cmd == "addon-remove" && len(args) != 1) {
		return fmt.Errorf("usage: %s <artemis|mobilerun> [version]", cmd)
	}
	dir, err := stateDir()
	if err != nil {
		return err
	}
	h := addonHost(dir)
	payload := map[string]any{"name": args[0]}
	verb := "addon_remove"
	if cmd == "addon-install" {
		verb = "addon_install"
		if len(args) == 2 {
			payload["version"] = args[1]
		}
		fmt.Println("Installing", args[0], "(downloads uv, Python and the add-on into the helper folder; a few minutes)…")
	}
	raw, _ := json.Marshal(payload)
	res, err := h.Handle(context.Background(), verb, raw)
	if err != nil {
		return err
	}
	if res != nil {
		fmt.Println(res)
	}
	return nil
}

func cmdAddonKey(args []string) error {
	if len(args) != 2 {
		return errors.New("usage: addon-key <artemis|mobilerun> <ENV_NAME>   (e.g. GEMINI_API_KEY)")
	}
	dir, err := stateDir()
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Value for %s (not shown; empty deletes it): ", args[1])
	value, err := readSecret()
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return err
	}
	return addonHost(dir).SetKey(args[0], args[1], value)
}

// readSecret reads one line with terminal echo off when stdin is a terminal.
func readSecret() (string, error) {
	if info, err := os.Stdin.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
		off := exec.Command("stty", "-echo")
		off.Stdin = os.Stdin
		if off.Run() == nil {
			defer func() {
				on := exec.Command("stty", "echo")
				on.Stdin = os.Stdin
				_ = on.Run()
			}()
		}
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
