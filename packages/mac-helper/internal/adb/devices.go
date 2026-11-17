package adb

import (
	"context"
	"strings"
)

// Device is one line of `adb devices -l`.
type Device struct {
	Serial string `json:"serial"`
	// State is adb's: device, unauthorized, offline, …
	State string `json:"state"`
	Model string `json:"model,omitempty"`
	// Transport is usb or wifi.
	Transport string `json:"transport"`
}

// Ready reports whether adb can run commands on it.
func (d Device) Ready() bool { return d.State == "device" }

// Devices lists the phones adb sees.
func Devices(ctx context.Context, r Runner) ([]Device, error) {
	out, err := r.Run(ctx, "devices", "-l")
	if err != nil {
		return nil, err
	}
	return ParseDevices(string(out)), nil
}

// ParseDevices parses `adb devices -l` output.
func ParseDevices(out string) []Device {
	var devices []Device
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.HasPrefix(line, "List of devices") || strings.HasPrefix(line, "*") {
			continue
		}
		d := Device{Serial: fields[0], State: fields[1], Transport: "wifi"}
		for _, attr := range fields[2:] {
			key, value, ok := strings.Cut(attr, ":")
			if !ok {
				continue
			}
			switch key {
			case "usb":
				d.Transport = "usb"
			case "model":
				d.Model = strings.ReplaceAll(value, "_", " ")
			}
		}
		devices = append(devices, d)
	}
	return devices
}
