// Package agent is the helper's relay.Handler: it keeps the phone inventory,
// applies the owner's local switches (defence in depth: core checks its own
// switch first) and runs W2 verbs through the adb, cdp and mac layers.
package agent

import (
	"context"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/adb"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/audit"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/config"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// Notifier shows the owner that agents are using a device (macOS notification).
type Notifier interface {
	Notify(title, body string)
}

// Optional layers; nil means the capability is absent.
type (
	// CDP tunnels phone Chrome sessions (mac relay only).
	CDP interface {
		Open(ctx context.Context, serial string) (string, error)
		Frame(session string, message []byte) error
		Close(session string) error
		CloseDevice(serial string)
	}
	// Mac runs the mac_* verbs (M3).
	Mac interface {
		Info() wire.Mac
		Handle(ctx context.Context, verb string, args []byte) (any, error)
	}
	// Addons hosts Artemis / Mobilerun (M2).
	Addons interface {
		Installed() []wire.Addon
		Handle(ctx context.Context, verb string, args []byte) (any, error)
		StopDevice(serial string)
	}
)

type phoneInfo struct {
	dev            adb.Device
	androidVersion string
	chrome         bool
}

// Agent implements relay.Handler.
type Agent struct {
	R      adb.Runner
	Log    *audit.Log
	Notify Notifier
	CDP    CDP
	Mac    Mac
	Addons Addons
	// Poll is the adb devices interval (default 3 s).
	Poll time.Duration

	mu       sync.Mutex
	cfg      *config.Config
	cfgStamp time.Time
	phones   map[string]phoneInfo
	emit     func(any)
	changes  chan struct{}
	locks    map[string]*sync.Mutex
	lastUse  map[string]time.Time
	running  map[string]map[*context.CancelFunc]struct{}
}

// New builds an Agent with the current config.
func New(r adb.Runner, log *audit.Log, cfg *config.Config) *Agent {
	return &Agent{
		R: r, Log: log, cfg: cfg,
		phones:  map[string]phoneInfo{},
		changes: make(chan struct{}, 1),
		locks:   map[string]*sync.Mutex{},
		lastUse: map[string]time.Time{},
		running: map[string]map[*context.CancelFunc]struct{}{},
	}
}

func (a *Agent) changed() {
	select {
	case a.changes <- struct{}{}:
	default:
	}
}

// Changes implements relay.Handler.
func (a *Agent) Changes() <-chan struct{} { return a.changes }

// SetEmitter implements relay.Handler.
func (a *Agent) SetEmitter(e func(any)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.emit = e
}

func (a *Agent) send(frame any) {
	a.mu.Lock()
	e := a.emit
	a.mu.Unlock()
	if e != nil {
		e(frame)
	}
}

// Enabled reports the owner's local switch for a device key.
func (a *Agent) Enabled(key string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.DeviceEnabled(key)
}

// Inventory implements relay.Handler.
func (a *Agent) Inventory() wire.Inventory {
	a.mu.Lock()
	phones := make([]wire.Phone, 0, len(a.phones))
	for serial, p := range a.phones {
		if !p.dev.Ready() {
			continue
		}
		name := p.dev.Model
		if name == "" {
			name = serial
		}
		phone := wire.Phone{Serial: serial, Name: name, Chrome: p.chrome && a.CDP != nil, Enabled: a.cfg.DeviceEnabled(serial)}
		if p.dev.Model != "" {
			model := p.dev.Model
			phone.Model = &model
		}
		if p.androidVersion != "" {
			v := p.androidVersion
			phone.AndroidVersion = &v
		}
		transport := p.dev.Transport
		phone.Transport = &transport
		phones = append(phones, phone)
	}
	macOn := a.cfg.DeviceEnabled(wire.DeviceMac)
	a.mu.Unlock()
	sortPhones(phones)
	var mac *wire.Mac
	if a.Mac != nil {
		info := a.Mac.Info()
		info.Enabled = macOn
		mac = &info
	}
	var addons []wire.Addon
	if a.Addons != nil {
		addons = a.Addons.Installed()
	}
	return wire.NewInventory(phones, mac, addons)
}

func sortPhones(p []wire.Phone) {
	for i := 1; i < len(p); i++ {
		for j := i; j > 0 && p[j].Serial < p[j-1].Serial; j-- {
			p[j], p[j-1] = p[j-1], p[j]
		}
	}
}

// Run polls adb and the config file until ctx ends.
func (a *Agent) Run(ctx context.Context, cfgPath string) {
	poll := a.Poll
	if poll == 0 {
		poll = 3 * time.Second
	}
	devices := time.NewTicker(poll)
	defer devices.Stop()
	cfgTick := time.NewTicker(time.Second)
	defer cfgTick.Stop()
	a.refreshPhones(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-devices.C:
			a.refreshPhones(ctx)
		case <-cfgTick.C:
			a.reloadConfig(cfgPath)
		}
	}
}

func (a *Agent) refreshPhones(ctx context.Context) {
	lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	list, err := adb.Devices(lctx, a.R)
	if err != nil {
		return
	}
	next := map[string]phoneInfo{}
	a.mu.Lock()
	prev := a.phones
	a.mu.Unlock()
	for _, d := range list {
		info := phoneInfo{dev: d}
		if old, ok := prev[d.Serial]; ok {
			info.androidVersion, info.chrome = old.androidVersion, old.chrome
		}
		if d.Ready() {
			phone := adb.Phone{R: a.R, Serial: d.Serial}
			if info.androidVersion == "" {
				info.androidVersion = phone.Prop(lctx, "ro.build.version.release")
			}
			info.chrome = phone.ChromeDevtools(lctx)
		}
		next[d.Serial] = info
	}
	a.mu.Lock()
	same := reflect.DeepEqual(prev, next)
	a.phones = next
	a.mu.Unlock()
	for serial := range prev {
		if _, ok := next[serial]; !ok {
			a.stopDevice(serial)
		}
	}
	if !same {
		a.changed()
	}
}

// reloadConfig picks up switches flipped by the CLI (`enable`, `disable`,
// `stop-all`). A device switched off stops at once and core is told.
func (a *Agent) reloadConfig(path string) {
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	a.mu.Lock()
	stamp := a.cfgStamp
	a.mu.Unlock()
	if !info.ModTime().After(stamp) {
		return
	}
	cfg, err := config.Load()
	if err != nil {
		return
	}
	a.mu.Lock()
	old := a.cfg
	a.cfg = cfg
	a.cfgStamp = info.ModTime()
	keys := map[string]bool{wire.DeviceMac: true}
	for serial := range a.phones {
		keys[serial] = true
	}
	for k := range old.Enabled {
		keys[k] = true
	}
	var off []string
	for k := range keys {
		if old.DeviceEnabled(k) && !cfg.DeviceEnabled(k) {
			off = append(off, k)
		}
	}
	a.mu.Unlock()
	for _, k := range off {
		a.stopDevice(k)
		a.send(wire.NewEvent(k, wire.EventLocalSwitchOff, nil))
	}
	a.changed()
}

// Stop implements relay.Handler (core's stop{device}).
func (a *Agent) Stop(device string) { a.stopDevice(device) }

func (a *Agent) stopDevice(device string) {
	a.mu.Lock()
	for cancel := range a.running[device] {
		(*cancel)()
	}
	delete(a.running, device)
	a.mu.Unlock()
	if a.CDP != nil {
		a.CDP.CloseDevice(device)
	}
	if a.Addons != nil {
		a.Addons.StopDevice(device)
	}
}

// begin registers a running verb so a switch-off or stop can cancel it.
func (a *Agent) begin(ctx context.Context, device string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(ctx)
	a.mu.Lock()
	if a.running[device] == nil {
		a.running[device] = map[*context.CancelFunc]struct{}{}
	}
	key := &cancel
	a.running[device][key] = struct{}{}
	a.mu.Unlock()
	return ctx, func() {
		a.mu.Lock()
		delete(a.running[device], key)
		a.mu.Unlock()
		cancel()
	}
}

func (a *Agent) lock(device string) *sync.Mutex {
	a.mu.Lock()
	defer a.mu.Unlock()
	l := a.locks[device]
	if l == nil {
		l = &sync.Mutex{}
		a.locks[device] = l
	}
	return l
}

// noticeUse shows a notification on the first verb after 2 idle minutes.
func (a *Agent) noticeUse(device string) {
	a.mu.Lock()
	last := a.lastUse[device]
	a.lastUse[device] = time.Now()
	name := device
	if p, ok := a.phones[device]; ok && p.dev.Model != "" {
		name = p.dev.Model
	}
	if device == wire.DeviceMac {
		name = "this Mac"
	}
	a.mu.Unlock()
	if a.Notify != nil && time.Since(last) > 2*time.Minute {
		a.Notify.Notify("AionUi is using "+name, "Agents are working on "+name+". Stop: aionui-mac-helper stop-all")
	}
}

func (a *Agent) phone(serial string) (phoneInfo, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.phones[serial]
	return p, ok
}

func summarize(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
