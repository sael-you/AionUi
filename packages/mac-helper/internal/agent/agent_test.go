package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/config"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/shot"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

type scriptRunner struct {
	mu    sync.Mutex
	calls []string
	out   func(args string) (string, error)
}

func (s *scriptRunner) Run(_ context.Context, args ...string) ([]byte, error) {
	line := strings.Join(args, " ")
	s.mu.Lock()
	s.calls = append(s.calls, line)
	s.mu.Unlock()
	out, err := s.out(line)
	return []byte(out), err
}

func (s *scriptRunner) called(sub string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.calls {
		if strings.Contains(c, sub) {
			return true
		}
	}
	return false
}

func testPNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		img.Set(x, 0, color.RGBA{255, 0, 0, 255})
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func setup(t *testing.T, enabled ...string) (*Agent, *scriptRunner, *[]any) {
	t.Helper()
	t.Setenv(config.DirEnv, t.TempDir())
	shot := testPNG(40, 20)
	r := &scriptRunner{out: func(line string) (string, error) {
		switch {
		case line == "devices -l":
			return "List of devices attached\nS1 device usb:1 model:Pixel_8\nS2 unauthorized usb:2\n", nil
		case strings.HasSuffix(line, "'getprop' 'ro.build.version.release'"):
			return "16\n", nil
		case strings.HasSuffix(line, "'cat' '/proc/net/unix'"):
			return "0000: 00000002 ... @chrome_devtools_remote\n", nil
		case strings.HasSuffix(line, "exec-out screencap -p"):
			return string(shot), nil
		case strings.Contains(line, " install -r "):
			return "Performing Streamed Install\nSuccess\n", nil
		}
		return "", nil
	}}
	cfg := &config.Config{Enabled: map[string]bool{}}
	for _, k := range enabled {
		cfg.Enabled[k] = true
	}
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	a := New(r, nil, cfg)
	var mu sync.Mutex
	events := &[]any{}
	a.SetEmitter(func(f any) {
		mu.Lock()
		defer mu.Unlock()
		*events = append(*events, f)
	})
	a.refreshPhones(context.Background())
	return a, r, events
}

func code(err error) string {
	var ve *wire.VerbError
	if errors.As(err, &ve) {
		return ve.Code
	}
	return "?"
}

func TestInventoryListsReadyPhonesWithSwitches(t *testing.T) {
	a, _, _ := setup(t, "S1")
	inv := a.Inventory()
	if len(inv.Phones) != 1 {
		t.Fatalf("phones %+v", inv.Phones)
	}
	p := inv.Phones[0]
	if p.Serial != "S1" || p.Name != "Pixel 8" || !p.Enabled || *p.AndroidVersion != "16" || *p.Transport != "usb" {
		t.Fatalf("phone %+v", p)
	}
	if p.Chrome {
		t.Fatal("chrome must be false without a CDP layer")
	}
	raw, _ := json.Marshal(inv)
	if !strings.Contains(string(raw), `"type":"inventory"`) || !strings.Contains(string(raw), `"addons":[]`) {
		t.Fatalf("frame %s", raw)
	}
}

func TestSwitchOffUnknownDeviceAndBadArgs(t *testing.T) {
	a, r, _ := setup(t)
	ctx := context.Background()
	if _, err := a.Handle(ctx, "S1", "tap", json.RawMessage(`{"x":1,"y":2}`)); code(err) != wire.ErrSwitchOff {
		t.Fatalf("switched-off phone: %v", err)
	}
	if r.called("input") {
		t.Fatal("a command ran on a switched-off phone")
	}
	if _, err := a.Handle(ctx, "S2", "tap", json.RawMessage(`{"x":1,"y":2}`)); code(err) != wire.ErrUnknownDevice {
		t.Fatalf("unauthorized phone: %v", err)
	}
	a2, r2, _ := setup(t, "S1")
	for _, tc := range []struct{ verb, args string }{
		{"tap", `{"x":-5,"y":2}`},
		{"tap", `{"x":1,"y":2,"z":3}`},
		{"text", `{"value":"naïve"}`},
		{"launch", `{"package":"com.x;reboot"}`},
		{"key", `{"code":"3;reboot"}`},
		{"screenshot", `{"scale":2}`},
		{"install_apk", `{"url":"http://x.com/a.apk","sha256":"` + strings.Repeat("a", 64) + `"}`},
		{"install_apk", `{"url":"https://x.com/a.apk","sha256":"short"}`},
	} {
		if _, err := a2.Handle(ctx, "S1", tc.verb, json.RawMessage(tc.args)); code(err) != wire.ErrBadArgs {
			t.Errorf("%s %s: %v", tc.verb, tc.args, err)
		}
	}
	if r2.called("input") || r2.called("monkey") {
		t.Fatal("invalid args reached adb")
	}
	if _, err := a2.Handle(ctx, "S1", "reboot", nil); code(err) != wire.ErrRefused {
		t.Fatalf("unknown verb: %v", err)
	}
}

func TestScreenshotScaling(t *testing.T) {
	a, _, _ := setup(t, "S1")
	res, err := a.Handle(context.Background(), "S1", "screenshot", nil)
	if err != nil {
		t.Fatal(err)
	}
	full := res.(shot.Screenshot)
	if full.Format != "png" || full.Width != 40 || full.Height != 20 {
		t.Fatalf("full %+v", full)
	}
	res, err = a.Handle(context.Background(), "S1", "screenshot", json.RawMessage(`{"scale":0.5}`))
	if err != nil {
		t.Fatal(err)
	}
	half := res.(shot.Screenshot)
	data, _ := base64.StdEncoding.DecodeString(half.DataBase64)
	if half.Format != "jpeg" || half.Width != 20 || half.Height != 10 || !bytes.HasPrefix(data, []byte{0xff, 0xd8}) {
		t.Fatalf("half %+v", half.Format)
	}
}

func TestInstallAPKChecksSHA256(t *testing.T) {
	apk := []byte("PK fake apk")
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(apk) }))
	defer srv.Close()
	old := HTTPClient
	HTTPClient = srv.Client()
	defer func() { HTTPClient = old }()
	a, r, _ := setup(t, "S1")
	sum := sha256.Sum256(apk)
	good := hex.EncodeToString(sum[:])
	args := func(s string) json.RawMessage {
		return json.RawMessage(`{"url":"` + srv.URL + `/a.apk","sha256":"` + s + `"}`)
	}
	if _, err := a.Handle(context.Background(), "S1", "install_apk", args(strings.Repeat("0", 64))); code(err) != wire.ErrRefused {
		t.Fatalf("mismatch: %v", err)
	}
	if r.called("install -r") {
		t.Fatal("installed despite a sha256 mismatch")
	}
	if _, err := a.Handle(context.Background(), "S1", "install_apk", args(strings.ToUpper(good))); err != nil {
		t.Fatalf("good sha: %v", err)
	}
	if !r.called("install -r") {
		t.Fatal("not installed")
	}
}

func TestLocalSwitchOffEmitsEventAndStopsRunningVerbs(t *testing.T) {
	a, _, events := setup(t, "S1")
	dir, _ := config.Dir()
	cfgPath := filepath.Join(dir, "config.json")
	a.reloadConfig(cfgPath)
	ctx, done := a.begin(context.Background(), "S1")
	defer done()
	cfg, _ := config.Load()
	cfg.Paused = true
	time.Sleep(10 * time.Millisecond)
	if err := cfg.Save(); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(time.Second)
	_ = os.Chtimes(cfgPath, future, future)
	a.reloadConfig(cfgPath)
	select {
	case <-ctx.Done():
	default:
		t.Fatal("running verb not cancelled by the switch")
	}
	found := false
	for _, e := range *events {
		if ev, ok := e.(wire.Event); ok && ev.Name == wire.EventLocalSwitchOff && ev.Device == "S1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no local_switch_off event in %+v", *events)
	}
	if _, err := a.Handle(context.Background(), "S1", "tap", json.RawMessage(`{"x":1,"y":1}`)); code(err) != wire.ErrSwitchOff {
		t.Fatalf("after stop-all: %v", err)
	}
}

func TestStopCancelsRunningVerb(t *testing.T) {
	a, _, _ := setup(t, "S1")
	ctx, done := a.begin(context.Background(), "S1")
	defer done()
	a.Stop("S1")
	if ctx.Err() == nil {
		t.Fatal("stop did not cancel")
	}
}
