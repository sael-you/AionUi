//go:build !darwin

package control

import "errors"

var errNotMac = errors.New("Mac control needs macOS")

// stubInput is used off macOS (Linux CI): nothing is granted, input fails.
type stubInput struct{}

func newInput() Input { return stubInput{} }

func (stubInput) ScreenGranted() bool           { return false }
func (stubInput) RequestScreen()                {}
func (stubInput) AccessibilityGranted() bool    { return false }
func (stubInput) MainDisplayPoints() (int, int) { return 0, 0 }
func (stubInput) Click(_, _ float64) error      { return errNotMac }
func (stubInput) TypeText(string) error         { return errNotMac }
func (stubInput) Key(uint16, uint64) error      { return errNotMac }
