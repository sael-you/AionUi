// Package adb runs Android Debug Bridge for the helper. Agents never get a
// shell: every verb is a fixed adb command whose arguments are validated here
// and, when they reach the device shell, single-quoted (see Quote).
package adb

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// BinEnv points at a specific adb binary (tests, a custom SDK).
const BinEnv = "AIONUI_MAC_HELPER_ADB"

// MaxOutput caps what one adb call may return (a screenshot is a few MB).
const MaxOutput = 32 << 20

// ErrOutputTooLarge is returned when adb printed more than MaxOutput bytes.
var ErrOutputTooLarge = errors.New("adb output too large")

// Runner executes adb with an argv (never through a host shell).
type Runner interface {
	Run(ctx context.Context, args ...string) ([]byte, error)
}

// Exec is the real Runner.
type Exec struct {
	Bin string
}

// Find returns the adb to use: $AIONUI_MAC_HELPER_ADB, the platform-tools the
// helper downloaded into its state dir, then adb on PATH.
func Find(stateDir string) (string, error) {
	if bin := os.Getenv(BinEnv); bin != "" {
		return bin, nil
	}
	local := filepath.Join(stateDir, "platform-tools", "adb")
	if info, err := os.Stat(local); err == nil && !info.IsDir() {
		return local, nil
	}
	if bin, err := exec.LookPath("adb"); err == nil {
		return bin, nil
	}
	return "", errors.New("adb not found: run `aionui-mac-helper install-adb` or put adb on PATH")
}

type capped struct {
	buf bytes.Buffer
	max int
	hit bool
}

func (c *capped) Write(p []byte) (int, error) {
	if c.buf.Len()+len(p) > c.max {
		c.hit = true
		return 0, ErrOutputTooLarge
	}
	return c.buf.Write(p)
}

// Run executes adb; stderr is folded into the error, never into the result.
func (e Exec) Run(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, e.Bin, args...)
	out := &capped{max: MaxOutput}
	var stderr bytes.Buffer
	cmd.Stdout = out
	cmd.Stderr = &stderr
	cmd.WaitDelay = 2 * time.Second
	err := cmd.Run()
	if out.hit {
		return nil, ErrOutputTooLarge
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("adb %s: %w", firstArg(args), ctx.Err())
		}
		msg := bytes.TrimSpace(stderr.Bytes())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("adb %s: %v: %s", firstArg(args), err, msg)
	}
	return out.buf.Bytes(), nil
}

func firstArg(args []string) string {
	for i, a := range args {
		// Skip "-s <serial>" so errors name the command.
		if a == "-s" {
			continue
		}
		if i > 0 && args[i-1] == "-s" {
			continue
		}
		return a
	}
	return ""
}
