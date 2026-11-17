package adb

import (
	"fmt"
	"regexp"
	"strings"
)

// Quote single-quotes one argument for the device's sh: `adb shell` joins its
// arguments with spaces and hands the line to `sh -c` on the phone.
func Quote(arg string) string {
	return "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
}

// ShellLine builds the line `adb shell` receives, every argument quoted.
func ShellLine(args ...string) string {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = Quote(a)
	}
	return strings.Join(quoted, " ")
}

var (
	packagePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`)
	keyNamePattern = regexp.MustCompile(`^KEYCODE_[A-Z0-9_]{1,40}$`)
)

// MaxTextLen bounds one `text` verb.
const MaxTextLen = 1000

// ValidPackage reports an Android application id.
func ValidPackage(pkg string) bool {
	return len(pkg) <= 255 && packagePattern.MatchString(pkg)
}

// ValidKey accepts a KEYCODE_* name or a key number 0–400.
func ValidKey(key string) bool {
	if keyNamePattern.MatchString(key) {
		return true
	}
	var n int
	_, err := fmt.Sscanf(key, "%d", &n)
	return err == nil && fmt.Sprint(n) == key && n >= 0 && n <= 400
}

// InputText encodes a value for `input text`: printable ASCII only (the tool
// cannot type other characters), spaces as %s. "%" is refused: `input text`
// reads it as an escape and has no documented literal form.
func InputText(value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("empty text")
	}
	if len(value) > MaxTextLen {
		return "", fmt.Errorf("text longer than %d characters", MaxTextLen)
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r == ' ':
			b.WriteString("%s")
		case r == '%':
			return "", fmt.Errorf("unsupported character %q", r)
		case r > ' ' && r < 0x7f:
			b.WriteRune(r)
		default:
			return "", fmt.Errorf("unsupported character %q: only printable ASCII can be typed", r)
		}
	}
	return b.String(), nil
}
