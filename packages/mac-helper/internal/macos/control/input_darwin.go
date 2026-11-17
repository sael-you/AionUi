//go:build darwin

package control

import (
	"fmt"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/ebitengine/purego"
)

// CoreGraphics / ApplicationServices through purego (no cgo).
type cgPoint struct{ X, Y float64 }

const (
	kCGHIDEventTap      = 0
	kCGEventLeftMouseDn = 1
	kCGEventLeftMouseUp = 2
	kCGEventMouseMoved  = 5
	kCGMouseButtonLeft  = 0
	typeChunk           = 20
	typePause           = 8 * time.Millisecond
	coreGraphicsPath    = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
	appServicesPath     = "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
	coreFoundationPath  = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
)

type cgInput struct {
	once sync.Once
	err  error

	createMouse    func(source uintptr, typ uint32, pos cgPoint, button uint32) uintptr
	createKey      func(source uintptr, key uint16, down bool) uintptr
	setUnicode     func(event uintptr, length uint64, chars *uint16)
	setFlags       func(event uintptr, flags uint64)
	post           func(tap uint32, event uintptr)
	release        func(ref uintptr)
	preflight      func() bool
	request        func() bool
	axTrusted      func() bool
	mainDisplay    func() uint32
	displayWidePts func(display uint32) uint64
	displayHighPts func(display uint32) uint64
}

func newInput() Input { return &cgInput{} }

func (c *cgInput) load() error {
	c.once.Do(func() {
		cg, err := purego.Dlopen(coreGraphicsPath, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			c.err = err
			return
		}
		as, err := purego.Dlopen(appServicesPath, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			c.err = err
			return
		}
		cf, err := purego.Dlopen(coreFoundationPath, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			c.err = err
			return
		}
		purego.RegisterLibFunc(&c.createMouse, cg, "CGEventCreateMouseEvent")
		purego.RegisterLibFunc(&c.createKey, cg, "CGEventCreateKeyboardEvent")
		purego.RegisterLibFunc(&c.setUnicode, cg, "CGEventKeyboardSetUnicodeString")
		purego.RegisterLibFunc(&c.setFlags, cg, "CGEventSetFlags")
		purego.RegisterLibFunc(&c.post, cg, "CGEventPost")
		purego.RegisterLibFunc(&c.preflight, cg, "CGPreflightScreenCaptureAccess")
		purego.RegisterLibFunc(&c.request, cg, "CGRequestScreenCaptureAccess")
		purego.RegisterLibFunc(&c.mainDisplay, cg, "CGMainDisplayID")
		purego.RegisterLibFunc(&c.displayWidePts, cg, "CGDisplayPixelsWide")
		purego.RegisterLibFunc(&c.displayHighPts, cg, "CGDisplayPixelsHigh")
		purego.RegisterLibFunc(&c.axTrusted, as, "AXIsProcessTrusted")
		purego.RegisterLibFunc(&c.release, cf, "CFRelease")
	})
	return c.err
}

func (c *cgInput) ScreenGranted() bool { return c.load() == nil && c.preflight() }

func (c *cgInput) RequestScreen() {
	if c.load() == nil {
		c.request()
	}
}

func (c *cgInput) AccessibilityGranted() bool { return c.load() == nil && c.axTrusted() }

// MainDisplayPoints: CGDisplayPixelsWide/High report the display mode's size,
// which is in points for HiDPI ("scaled") modes.
func (c *cgInput) MainDisplayPoints() (int, int) {
	if c.load() != nil {
		return 0, 0
	}
	d := c.mainDisplay()
	return int(c.displayWidePts(d)), int(c.displayHighPts(d))
}

func (c *cgInput) postMouse(typ uint32, x, y float64) error {
	ev := c.createMouse(0, typ, cgPoint{x, y}, kCGMouseButtonLeft)
	if ev == 0 {
		return fmt.Errorf("CGEventCreateMouseEvent failed")
	}
	defer c.release(ev)
	c.post(kCGHIDEventTap, ev)
	return nil
}

func (c *cgInput) Click(x, y float64) error {
	if err := c.load(); err != nil {
		return err
	}
	for _, typ := range []uint32{kCGEventMouseMoved, kCGEventLeftMouseDn, kCGEventLeftMouseUp} {
		if err := c.postMouse(typ, x, y); err != nil {
			return err
		}
		time.Sleep(15 * time.Millisecond)
	}
	return nil
}

func (c *cgInput) TypeText(s string) error {
	if err := c.load(); err != nil {
		return err
	}
	units := utf16.Encode([]rune(s))
	for len(units) > 0 {
		n := min(typeChunk, len(units))
		chunk := units[:n]
		units = units[n:]
		for _, down := range []bool{true, false} {
			ev := c.createKey(0, 0, down)
			if ev == 0 {
				return fmt.Errorf("CGEventCreateKeyboardEvent failed")
			}
			c.setUnicode(ev, uint64(len(chunk)), &chunk[0])
			c.post(kCGHIDEventTap, ev)
			c.release(ev)
		}
		time.Sleep(typePause)
	}
	return nil
}

func (c *cgInput) Key(code uint16, flags uint64) error {
	if err := c.load(); err != nil {
		return err
	}
	for _, down := range []bool{true, false} {
		ev := c.createKey(0, code, down)
		if ev == 0 {
			return fmt.Errorf("CGEventCreateKeyboardEvent failed")
		}
		if flags != 0 {
			c.setFlags(ev, flags)
		}
		c.post(kCGHIDEventTap, ev)
		c.release(ev)
	}
	return nil
}
