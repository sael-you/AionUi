// Package wire mirrors core's W2 relay frames (aionui-api-types
// src/devices.rs, RelayInbound / RelayOutbound). That Rust file is the single
// source: change it there first, then here. Frames are JSON text with a
// snake_case "type" tag.
package wire

import (
	"encoding/json"
	"fmt"
)

// Limits and timings from devices.rs.
const (
	Path          = "/api/devices/relay"
	MaxFrameBytes = 16 * 1024 * 1024
	PingSecs      = 20
	IdleCloseSecs = 60
	DeviceSelf    = "self"
	DeviceMac     = "mac"
	KindMacHelper = "mac_helper"
)

// relay_error codes.
const (
	ErrSwitchOff     = "switch_off"
	ErrUnknownDevice = "unknown_device"
	ErrRefused       = "refused"
	ErrTimeout       = "timeout"
	ErrBusy          = "busy"
	ErrBadArgs       = "bad_args"
	ErrFailed        = "failed"
)

// relay_event names.
const (
	EventLocalSwitchOff = "local_switch_off"
	EventForeground     = "foreground"
	EventAddonProgress  = "addon_progress"
	EventCDPFrame       = "cdp_frame"
	EventCDPClosed      = "cdp_closed"
)

// Client → core.

type Pair struct {
	Type         string   `json:"type"`
	Code         string   `json:"code"`
	Kind         string   `json:"kind"`
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type Hello struct {
	Type         string   `json:"type"`
	Token        string   `json:"token"`
	Kind         string   `json:"kind"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type Phone struct {
	Serial         string  `json:"serial"`
	Name           string  `json:"name"`
	Model          *string `json:"model,omitempty"`
	AndroidVersion *string `json:"android_version,omitempty"`
	Transport      *string `json:"transport,omitempty"`
	Chrome         bool    `json:"chrome"`
	Enabled        bool    `json:"enabled"`
}

type Mac struct {
	Name          string  `json:"name"`
	OSVersion     *string `json:"os_version,omitempty"`
	PermissionsOK bool    `json:"permissions_ok"`
	Enabled       bool    `json:"enabled"`
}

type Addon struct {
	Name      string  `json:"name"`
	Version   *string `json:"version,omitempty"`
	DiskBytes *uint64 `json:"disk_bytes,omitempty"`
}

type Inventory struct {
	Type   string  `json:"type"`
	Phones []Phone `json:"phones"`
	Mac    *Mac    `json:"mac,omitempty"`
	Addons []Addon `json:"addons"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Response struct {
	Type   string `json:"type"`
	ID     uint64 `json:"id"`
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  *Error `json:"error,omitempty"`
}

type Event struct {
	Type   string `json:"type"`
	Device string `json:"device"`
	Name   string `json:"name"`
	Data   any    `json:"data"`
}

// Core → client: one struct for every outbound frame (fields by type).
type Outbound struct {
	Type     string          `json:"type"`
	ClientID string          `json:"client_id,omitempty"`
	Token    string          `json:"token,omitempty"`
	Code     string          `json:"code,omitempty"`
	ID       uint64          `json:"id,omitempty"`
	Device   string          `json:"device,omitempty"`
	Verb     string          `json:"verb,omitempty"`
	Args     json.RawMessage `json:"args,omitempty"`
}

// Outbound types.
const (
	TypeWelcome = "welcome"
	TypeError   = "error"
	TypeRequest = "request"
	TypeStop    = "stop"
	TypePong    = "pong"
)

// NewPair, NewHello, … set the type tag.
func NewPair(code, name, version string, caps []string) Pair {
	return Pair{Type: "pair", Code: code, Kind: KindMacHelper, Name: name, Version: version, Capabilities: caps}
}

func NewHello(token, version string, caps []string) Hello {
	return Hello{Type: "hello", Token: token, Kind: KindMacHelper, Version: version, Capabilities: caps}
}

func NewInventory(phones []Phone, mac *Mac, addons []Addon) Inventory {
	if phones == nil {
		phones = []Phone{}
	}
	if addons == nil {
		addons = []Addon{}
	}
	return Inventory{Type: "inventory", Phones: phones, Mac: mac, Addons: addons}
}

func OK(id uint64, result any) Response {
	return Response{Type: "response", ID: id, OK: true, Result: result}
}

func Fail(id uint64, code, message string) Response {
	return Response{Type: "response", ID: id, OK: false, Error: &Error{Code: code, Message: message}}
}

func NewEvent(device, name string, data any) Event {
	if data == nil {
		data = map[string]any{}
	}
	return Event{Type: "event", Device: device, Name: name, Data: data}
}

// Ping is the client keepalive.
var Ping = map[string]string{"type": "ping"}

// DecodeOutbound parses one core frame.
func DecodeOutbound(raw []byte) (Outbound, error) {
	var f Outbound
	if err := json.Unmarshal(raw, &f); err != nil {
		return f, err
	}
	switch f.Type {
	case TypeWelcome, TypeError, TypeRequest, TypeStop, TypePong:
		return f, nil
	default:
		return f, fmt.Errorf("unknown frame type %q", f.Type)
	}
}

// VerbError is a verb failure with its W2 code.
type VerbError struct {
	Code    string
	Message string
}

func (e *VerbError) Error() string { return e.Code + ": " + e.Message }

// Errorf builds a VerbError.
func Errorf(code, format string, a ...any) *VerbError {
	return &VerbError{Code: code, Message: fmt.Sprintf(format, a...)}
}
