package adb

import (
	"context"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls [][]string
	out   map[string]string
}

func (f *fakeRunner) Run(_ context.Context, args ...string) ([]byte, error) {
	f.calls = append(f.calls, args)
	return []byte(f.out[strings.Join(args, " ")]), nil
}

func TestParseDevices(t *testing.T) {
	out := `List of devices attached
R5CT1 device usb:1-1 product:x model:Galaxy_S24 device:y transport_id:3
192.168.1.20:37895 device product:p model:Pixel_8 device:shiba transport_id:4
adb-35121FDJH-xyMD0H._adb-tls-connect._tcp unauthorized transport_id:5
* daemon started successfully
`
	got := ParseDevices(out)
	if len(got) != 3 {
		t.Fatalf("got %d devices: %+v", len(got), got)
	}
	if got[0] != (Device{Serial: "R5CT1", State: "device", Model: "Galaxy S24", Transport: "usb"}) {
		t.Errorf("usb device: %+v", got[0])
	}
	if got[1].Transport != "wifi" || got[1].Model != "Pixel 8" || !got[1].Ready() {
		t.Errorf("wifi device: %+v", got[1])
	}
	if got[2].Ready() {
		t.Errorf("unauthorized device must not be ready")
	}
}

func TestQuoteKeepsInjectionInsideOneArgument(t *testing.T) {
	line := ShellLine("input", "text", "a'; rm -rf /sdcard; echo '")
	if line != `'input' 'text' 'a'\''; rm -rf /sdcard; echo '\'''` {
		t.Fatalf("line: %s", line)
	}
}

func TestInputText(t *testing.T) {
	cases := map[string]string{"hello world": "hello%sworld", "a&b|c": "a&b|c"}
	for in, want := range cases {
		got, err := InputText(in)
		if err != nil || got != want {
			t.Errorf("InputText(%q) = %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "café", "100%", "tab\there", strings.Repeat("a", MaxTextLen+1)} {
		if _, err := InputText(bad); err == nil {
			t.Errorf("InputText(%q) accepted", bad)
		}
	}
}

func TestValidators(t *testing.T) {
	for _, ok := range []string{"com.android.chrome", "org.x_y.app2"} {
		if !ValidPackage(ok) {
			t.Errorf("package %q refused", ok)
		}
	}
	for _, bad := range []string{"chrome", "com.x;reboot", "../x", "com..x", ""} {
		if ValidPackage(bad) {
			t.Errorf("package %q accepted", bad)
		}
	}
	for _, ok := range []string{"KEYCODE_HOME", "3", "400"} {
		if !ValidKey(ok) {
			t.Errorf("key %q refused", ok)
		}
	}
	for _, bad := range []string{"KEYCODE_home", "401", "-1", "3;reboot", "03"} {
		if ValidKey(bad) {
			t.Errorf("key %q accepted", bad)
		}
	}
}

func TestVerbsBuildFixedCommands(t *testing.T) {
	f := &fakeRunner{out: map[string]string{}}
	p := Phone{R: f, Serial: "S1"}
	ctx := context.Background()
	if err := p.Tap(ctx, 10, 20); err != nil {
		t.Fatal(err)
	}
	if err := p.Text(ctx, "hi there"); err != nil {
		t.Fatal(err)
	}
	if err := p.Tap(ctx, -1, 5); err == nil {
		t.Fatal("negative coordinate accepted")
	}
	if err := p.Swipe(ctx, 0, 0, 10, 10, MaxSwipeMs+1); err == nil {
		t.Fatal("long swipe accepted")
	}
	if err := p.Launch(ctx, "com.x;reboot"); err == nil {
		t.Fatal("bad package accepted")
	}
	want := [][]string{
		{"-s", "S1", "shell", "'input' 'tap' '10' '20'"},
		{"-s", "S1", "shell", "'input' 'text' 'hi%sthere'"},
	}
	if len(f.calls) != len(want) {
		t.Fatalf("calls: %q", f.calls)
	}
	for i := range want {
		if strings.Join(f.calls[i], "|") != strings.Join(want[i], "|") {
			t.Errorf("call %d = %q, want %q", i, f.calls[i], want[i])
		}
	}
}

func TestScreenshotNeedsPNG(t *testing.T) {
	f := &fakeRunner{out: map[string]string{"-s S1 exec-out screencap -p": "not a png"}}
	if _, err := (Phone{R: f, Serial: "S1"}).Screenshot(context.Background()); err == nil {
		t.Fatal("non-PNG accepted")
	}
}

func TestUITreeStripsStatusLine(t *testing.T) {
	f := &fakeRunner{out: map[string]string{
		"-s S1 exec-out uiautomator dump /dev/tty": "<?xml version='1.0'?><hierarchy rotation=\"0\"></hierarchy>UI hierchary dumped to: /dev/tty\n",
	}}
	xml, err := (Phone{R: f, Serial: "S1"}).UITree(context.Background())
	if err != nil || !strings.HasSuffix(xml, "</hierarchy>") {
		t.Fatalf("xml %q err %v", xml, err)
	}
}

func TestParseForeground(t *testing.T) {
	out := "  topResumedActivity=ActivityRecord{a1b2 u0 com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity t12}\n"
	fg, err := ParseForeground(out)
	if err != nil || fg.Package != "com.android.chrome" || fg.Activity != "org.chromium.chrome.browser.ChromeTabbedActivity" {
		t.Fatalf("%+v %v", fg, err)
	}
	fg, err = ParseForeground("mResumedActivity: ActivityRecord{x u0 com.whatsapp/.HomeActivity t3}")
	if err != nil || fg.Activity != "com.whatsapp.HomeActivity" {
		t.Fatalf("relative activity: %+v %v", fg, err)
	}
	if _, err := ParseForeground("nothing"); err == nil {
		t.Fatal("no activity accepted")
	}
}
