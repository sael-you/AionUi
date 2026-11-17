package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/adb"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/audit"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/shot"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

func badArgs(err error) error { return wire.Errorf(wire.ErrBadArgs, "%v", err) }

func decode(args json.RawMessage, v any) error {
	if len(args) == 0 || string(args) == "null" {
		args = []byte("{}")
	}
	dec := json.NewDecoder(strings.NewReader(string(args)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return badArgs(err)
	}
	return nil
}

// failed wraps an adb/OS error; a cancelled context reads as stopped.
func failed(ctx context.Context, err error) error {
	var ve *wire.VerbError
	if errors.As(err, &ve) {
		return err
	}
	if ctx.Err() != nil {
		return wire.Errorf(wire.ErrFailed, "stopped")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return wire.Errorf(wire.ErrTimeout, "%v", err)
	}
	return wire.Errorf(wire.ErrFailed, "%v", err)
}

// Handle implements relay.Handler.
func (a *Agent) Handle(ctx context.Context, device, verb string, args json.RawMessage) (result any, err error) {
	started := time.Now()
	detail := map[string]string{}
	defer func() {
		e := audit.Entry{Device: device, Verb: verb, OK: err == nil, DurationMs: time.Since(started).Milliseconds(), Detail: detail}
		if err != nil {
			e.Error = summarize(err.Error(), 200)
		}
		if a.Log != nil && verb != "cdp_frame" {
			a.Log.Write(e)
		}
	}()
	switch {
	case strings.HasPrefix(verb, "addon_"):
		if a.Addons == nil {
			return nil, wire.Errorf(wire.ErrRefused, "no add-on host on this Mac")
		}
		result, err := a.Addons.Handle(ctx, verb, args)
		if err == nil && (verb == "addon_install" || verb == "addon_remove") {
			a.changed()
		}
		if verb == "addon_run" {
			// The task text is the owner's business: only its size is logged.
			var in struct{ Name, Task, Device string }
			_ = json.Unmarshal(args, &in)
			detail["addon"], detail["task_chars"], detail["phone"] = in.Name, strconv.Itoa(len([]rune(in.Task))), in.Device
		}
		return result, err
	case strings.HasPrefix(verb, "mac_"):
		if device != wire.DeviceMac || a.Mac == nil {
			return nil, wire.Errorf(wire.ErrUnknownDevice, "this helper does not control the Mac")
		}
		if !a.Enabled(wire.DeviceMac) {
			return nil, wire.Errorf(wire.ErrSwitchOff, "the Mac is switched off in the helper")
		}
		a.noticeUse(device)
		ctx, done := a.begin(ctx, device)
		defer done()
		return a.Mac.Handle(ctx, verb, args)
	}
	p, known := a.phone(device)
	if !known || !p.dev.Ready() {
		return nil, wire.Errorf(wire.ErrUnknownDevice, "no ready phone %q on this Mac", device)
	}
	if !a.Enabled(device) {
		return nil, wire.Errorf(wire.ErrSwitchOff, "%s is switched off in the helper", device)
	}
	if verb == "cdp_frame" || verb == "cdp_close" {
		return a.cdpVerb(verb, args)
	}
	a.noticeUse(device)
	ctx, done := a.begin(ctx, device)
	defer done()
	if verb == "stop" {
		a.stopDevice(device)
		return nil, nil
	}
	// One verb at a time per phone: concurrent input would interleave.
	l := a.lock(device)
	l.Lock()
	defer l.Unlock()
	phone := adb.Phone{R: a.R, Serial: device}
	result, err = a.phoneVerb(ctx, phone, verb, args, detail)
	if err != nil {
		return nil, failed(ctx, err)
	}
	return result, nil
}

func (a *Agent) phoneVerb(ctx context.Context, phone adb.Phone, verb string, args json.RawMessage, detail map[string]string) (any, error) {
	switch verb {
	case "screenshot":
		var in struct {
			Scale *float64 `json:"scale"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		scale := 1.0
		if in.Scale != nil {
			scale = *in.Scale
		}
		if scale <= 0 || scale > 1 {
			return nil, wire.Errorf(wire.ErrBadArgs, "scale must be 0 < scale ≤ 1")
		}
		png, err := phone.Screenshot(ctx)
		if err != nil {
			return nil, err
		}
		return shot.Encode(png, scale)
	case "ui_tree":
		if err := decode(args, &struct{}{}); err != nil {
			return nil, err
		}
		xml, err := phone.UITree(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]string{"xml": xml}, nil
	case "tap":
		var in struct{ X, Y int }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		detail["x"], detail["y"] = strconv.Itoa(in.X), strconv.Itoa(in.Y)
		return nil, asBadArgs(phone.Tap(ctx, in.X, in.Y))
	case "swipe":
		var in struct {
			X1, Y1, X2, Y2 int
			DurationMs     int `json:"duration_ms"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		return nil, asBadArgs(phone.Swipe(ctx, in.X1, in.Y1, in.X2, in.Y2, in.DurationMs))
	case "text":
		var in struct{ Value string }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		detail["chars"] = strconv.Itoa(len([]rune(in.Value)))
		return nil, asBadArgs(phone.Text(ctx, in.Value))
	case "key":
		var in struct{ Code json.RawMessage }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		// `code` is a KEYCODE_* name or a key number.
		code := strings.Trim(string(in.Code), `"`)
		detail["code"] = code
		return nil, asBadArgs(phone.Key(ctx, code))
	case "launch":
		var in struct{ Package string }
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		detail["package"] = in.Package
		if !adb.ValidPackage(in.Package) {
			return nil, wire.Errorf(wire.ErrBadArgs, "invalid package")
		}
		return nil, phone.Launch(ctx, in.Package)
	case "foreground":
		if err := decode(args, &struct{}{}); err != nil {
			return nil, err
		}
		fg, err := phone.ForegroundApp(ctx)
		if err != nil {
			return nil, err
		}
		detail["package"] = fg.Package
		a.send(wire.NewEvent(phone.Serial, wire.EventForeground, map[string]string{"package": fg.Package}))
		return map[string]string{"package": fg.Package}, nil
	case "install_apk":
		var in struct {
			URL    string `json:"url"`
			SHA256 string `json:"sha256"`
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		detail["sha256"] = summarize(in.SHA256, 12)
		return nil, a.installAPK(ctx, phone, in.URL, in.SHA256)
	case "logcat":
		var in struct {
			Package string
			Lines   int
		}
		if err := decode(args, &in); err != nil {
			return nil, err
		}
		detail["package"] = in.Package
		if !adb.ValidPackage(in.Package) || in.Lines <= 0 || in.Lines > adb.MaxLogLines {
			return nil, wire.Errorf(wire.ErrBadArgs, "package or lines out of range")
		}
		out, err := phone.Logcat(ctx, in.Package, in.Lines)
		if err != nil {
			return nil, err
		}
		lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
		if len(lines) == 1 && lines[0] == "" {
			lines = []string{}
		}
		return map[string][]string{"lines": lines}, nil
	case "cdp_open":
		if err := decode(args, &struct{}{}); err != nil {
			return nil, err
		}
		if a.CDP == nil {
			return nil, wire.Errorf(wire.ErrRefused, "Chrome tunnelling is not available")
		}
		session, err := a.CDP.Open(ctx, phone.Serial)
		if err != nil {
			return nil, err
		}
		return map[string]string{"session": session}, nil
	}
	return nil, wire.Errorf(wire.ErrRefused, "unknown verb %q", verb)
}

// asBadArgs maps validation errors from the adb layer (no command ran).
func asBadArgs(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "out of range") || strings.Contains(msg, "invalid") ||
		strings.Contains(msg, "unsupported character") || strings.Contains(msg, "empty text") ||
		strings.Contains(msg, "longer than") {
		return wire.Errorf(wire.ErrBadArgs, "%s", msg)
	}
	return err
}

func (a *Agent) cdpVerb(verb string, args json.RawMessage) (any, error) {
	if a.CDP == nil {
		return nil, wire.Errorf(wire.ErrRefused, "Chrome tunnelling is not available")
	}
	var in struct {
		Session string          `json:"session"`
		Message json.RawMessage `json:"message"`
	}
	if err := decode(args, &in); err != nil {
		return nil, err
	}
	if verb == "cdp_close" {
		return nil, a.CDP.Close(in.Session)
	}
	msg := []byte(in.Message)
	// Accept a JSON-encoded string too; Chrome gets the object text.
	var asString string
	if json.Unmarshal(in.Message, &asString) == nil {
		msg = []byte(asString)
	}
	if !json.Valid(msg) {
		return nil, wire.Errorf(wire.ErrBadArgs, "message is not JSON")
	}
	return nil, a.CDP.Frame(in.Session, msg)
}
