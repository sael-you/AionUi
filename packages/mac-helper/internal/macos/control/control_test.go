package control

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"os"
	"strings"
	"testing"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/shot"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

type fakeInput struct {
	screen, ax bool
	w, h       int
	requested  bool
	clicks     [][2]float64
	typed      []string
	keys       [][2]uint64
}

func (f *fakeInput) ScreenGranted() bool        { return f.screen }
func (f *fakeInput) RequestScreen()             { f.requested = true }
func (f *fakeInput) AccessibilityGranted() bool { return f.ax }
func (f *fakeInput) MainDisplayPoints() (int, int) {
	if f.w == 0 {
		return 1440, 900
	}
	return f.w, f.h
}
func (f *fakeInput) Click(x, y float64) error {
	f.clicks = append(f.clicks, [2]float64{x, y})
	return nil
}
func (f *fakeInput) TypeText(s string) error { f.typed = append(f.typed, s); return nil }
func (f *fakeInput) Key(c uint16, fl uint64) error {
	f.keys = append(f.keys, [2]uint64{uint64(c), fl})
	return nil
}

func code(err error) string {
	var ve *wire.VerbError
	if errors.As(err, &ve) {
		return ve.Code
	}
	return "?"
}

func controller(in *fakeInput, run func(name string, args []string) ([]byte, error)) *Controller {
	return &Controller{In: in, TempDir: os.TempDir(), Run: func(_ context.Context, name string, args ...string) ([]byte, error) {
		return run(name, args)
	}}
}

func TestPermissionsAreRequiredAndNamed(t *testing.T) {
	in := &fakeInput{}
	ran := false
	c := controller(in, func(string, []string) ([]byte, error) { ran = true; return nil, nil })
	ctx := context.Background()
	_, err := c.Handle(ctx, "mac_screenshot", nil)
	if code(err) != wire.ErrRefused || !strings.Contains(err.Error(), "Screen Recording") || !in.requested {
		t.Fatalf("screenshot without permission: %v (requested %v)", err, in.requested)
	}
	for _, verb := range []string{"mac_click", "mac_type", "mac_key", "mac_ax_tree"} {
		args := map[string]string{"mac_click": `{"x":1,"y":1}`, "mac_type": `{"value":"hi"}`, "mac_key": `{"code":"return"}`, "mac_ax_tree": `{}`}[verb]
		if _, err := c.Handle(ctx, verb, []byte(args)); code(err) != wire.ErrRefused || !strings.Contains(err.Error(), "Accessibility") {
			t.Errorf("%s: %v", verb, err)
		}
	}
	if ran || len(in.clicks)+len(in.typed)+len(in.keys) > 0 {
		t.Fatal("something ran without permission")
	}
}

func TestInputVerbs(t *testing.T) {
	in := &fakeInput{screen: true, ax: true}
	var opened []string
	c := controller(in, func(name string, args []string) ([]byte, error) {
		opened = append(opened, name+" "+strings.Join(args, " "))
		return nil, nil
	})
	ctx := context.Background()
	if _, err := c.Handle(ctx, "mac_click", []byte(`{"x":100,"y":200}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Handle(ctx, "mac_click", []byte(`{"x":1440,"y":10}`)); code(err) != wire.ErrBadArgs {
		t.Fatalf("off-screen click: %v", err)
	}
	if _, err := c.Handle(ctx, "mac_type", []byte(`{"value":"héllo"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Handle(ctx, "mac_type", []byte(`{"value":""}`)); code(err) != wire.ErrBadArgs {
		t.Fatalf("empty type: %v", err)
	}
	if _, err := c.Handle(ctx, "mac_key", []byte(`{"code":"cmd+shift+4"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Handle(ctx, "mac_open_app", []byte(`{"bundle_id":"com.apple.Safari"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Handle(ctx, "mac_open_app", []byte(`{"bundle_id":"-a Terminal"}`)); code(err) != wire.ErrBadArgs {
		t.Fatalf("bad bundle: %v", err)
	}
	if len(in.clicks) != 1 || in.clicks[0] != [2]float64{100, 200} || len(in.typed) != 1 || in.typed[0] != "héllo" {
		t.Fatalf("input %+v", in)
	}
	if in.keys[0] != [2]uint64{21, 0x100000 | 0x20000} {
		t.Fatalf("key %+v", in.keys)
	}
	if len(opened) != 1 || opened[0] != "/usr/bin/open -b com.apple.Safari" {
		t.Fatalf("open %v", opened)
	}
}

func TestParseKey(t *testing.T) {
	for _, bad := range []string{"", "cmd+", "hyper+a", "cmd+nope", "a+b+c+d+e"} {
		if _, _, err := ParseKey(bad); err == nil {
			t.Errorf("ParseKey(%q) accepted", bad)
		}
	}
	if c, f, err := ParseKey("Return"); err != nil || c != 36 || f != 0 {
		t.Fatalf("return: %d %d %v", c, f, err)
	}
}

func TestScreenshotIsScaledToPoints(t *testing.T) {
	// A 2× (Retina) capture of a 144×90-point display.
	in := &fakeInput{screen: true, w: 144, h: 90}
	img := image.NewRGBA(image.Rect(0, 0, 288, 180))
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	c := controller(in, func(name string, args []string) ([]byte, error) {
		if name != "/usr/sbin/screencapture" || args[0] != "-x" {
			t.Errorf("tool %s %v", name, args)
		}
		return nil, os.WriteFile(args[len(args)-1], buf.Bytes(), 0o600)
	})
	res, err := c.Handle(context.Background(), "mac_screenshot", nil)
	if err != nil {
		t.Fatal(err)
	}
	s := res.(shot.Screenshot)
	data, _ := base64.StdEncoding.DecodeString(s.DataBase64)
	if s.Width != 144 || s.Height != 90 || s.Format != "jpeg" || len(data) == 0 {
		t.Fatalf("%+v", s.Format)
	}
}

func TestAXTreeParsesJSON(t *testing.T) {
	in := &fakeInput{ax: true}
	c := controller(in, func(name string, args []string) ([]byte, error) {
		if name != "/usr/bin/osascript" || args[1] != "JavaScript" || !strings.Contains(args[3], "AXSecureTextField") {
			t.Errorf("tool %s %v", name, args[:2])
		}
		return []byte(`{"app":"Safari","windows":[]}` + "\n"), nil
	})
	res, err := c.Handle(context.Background(), "mac_ax_tree", []byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	tree := res.(map[string]any)["tree"].(map[string]any)
	if tree["app"] != "Safari" {
		t.Fatalf("%v", tree)
	}
}
