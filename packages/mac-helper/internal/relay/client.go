// Package relay is the helper's outbound W2 connection to AionCore
// (`wss://<server>/api/devices/relay`, C38 §7). It never sends an Origin
// header (core refuses browser origins) and never puts the token in the URL.
package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// Handler runs verbs and describes what the helper reaches.
type Handler interface {
	// Handle runs one verb; a *wire.VerbError carries its W2 code.
	Handle(ctx context.Context, device, verb string, args json.RawMessage) (any, error)
	// Stop cancels everything running on a device (core's `stop`).
	Stop(device string)
	// Inventory is the current state for an `inventory` frame.
	Inventory() wire.Inventory
	// Changes fires when the inventory changed (phone attached, switch flipped).
	Changes() <-chan struct{}
	// SetEmitter gives the handler a way to send events.
	SetEmitter(func(frame any))
}

// ErrRevoked means AionUi no longer accepts this helper's token: re-pair.
var ErrRevoked = errors.New("device token revoked: pair again")

// ErrPairing means the pairing code was refused.
var ErrPairing = errors.New("pairing code refused (wrong, used or expired)")

// URL turns an AionUi origin into the relay URL.
func URL(server string) (string, error) {
	switch {
	case strings.HasPrefix(server, "https://"):
		return "wss://" + strings.TrimPrefix(server, "https://") + wire.Path, nil
	case strings.HasPrefix(server, "http://"):
		return "ws://" + strings.TrimPrefix(server, "http://") + wire.Path, nil
	}
	return "", fmt.Errorf("unsupported server %q", server)
}

func dial(ctx context.Context, server string) (*websocket.Conn, error) {
	u, err := URL(server)
	if err != nil {
		return nil, err
	}
	dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	// No HTTPHeader: Go sends no Origin, which the relay requires.
	conn, _, err := websocket.Dial(dctx, u, &websocket.DialOptions{})
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(wire.MaxFrameBytes + 64<<10)
	return conn, nil
}

func writeJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(raw) > wire.MaxFrameBytes {
		return fmt.Errorf("frame of %d bytes exceeds the relay limit", len(raw))
	}
	wctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, raw)
}

func readFrame(ctx context.Context, conn *websocket.Conn) (wire.Outbound, error) {
	_, raw, err := conn.Read(ctx)
	if err != nil {
		return wire.Outbound{}, err
	}
	return wire.DecodeOutbound(raw)
}

func expectWelcome(ctx context.Context, conn *websocket.Conn) (wire.Outbound, error) {
	rctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	f, err := readFrame(rctx, conn)
	if err != nil {
		return f, err
	}
	switch f.Type {
	case wire.TypeWelcome:
		return f, nil
	case wire.TypeError:
		switch f.Code {
		case "DEVICE_REVOKED":
			return f, ErrRevoked
		case "DEVICE_PAIRING_INVALID":
			return f, ErrPairing
		}
		return f, fmt.Errorf("relay refused: %s", f.Code)
	}
	return f, fmt.Errorf("unexpected %q before welcome", f.Type)
}

// Pair exchanges a one-time code for the helper's client id and token.
func Pair(ctx context.Context, server, code, name, version string, caps []string) (clientID, token string, err error) {
	conn, err := dial(ctx, server)
	if err != nil {
		return "", "", err
	}
	defer conn.Close(websocket.StatusNormalClosure, "paired")
	if err := writeJSON(ctx, conn, wire.NewPair(code, name, version, caps)); err != nil {
		return "", "", err
	}
	f, err := expectWelcome(ctx, conn)
	if err != nil {
		return "", "", err
	}
	if f.Token == "" || f.ClientID == "" {
		return "", "", errors.New("welcome without token")
	}
	return f.ClientID, f.Token, nil
}

// Client keeps the relay session up.
type Client struct {
	Server  string
	Token   string
	Version string
	Caps    []string
	H       Handler
	// OnState reports connection changes (status line, logs).
	OnState func(connected bool, err error)
	// MaxBackoff caps the reconnect delay (default 60 s).
	MaxBackoff time.Duration
}

// Run connects and reconnects until ctx ends or the token is revoked.
func (c *Client) Run(ctx context.Context) error {
	backoff := time.Second
	maxBackoff := c.MaxBackoff
	if maxBackoff == 0 {
		maxBackoff = 60 * time.Second
	}
	for {
		started := time.Now()
		err := c.session(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if c.OnState != nil {
			c.OnState(false, err)
		}
		if errors.Is(err, ErrRevoked) {
			return err
		}
		// A session that lasted resets the backoff.
		if time.Since(started) > 2*time.Minute {
			backoff = time.Second
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, maxBackoff)
	}
}

type session struct {
	conn    *websocket.Conn
	ctx     context.Context
	out     chan any
	mu      sync.Mutex
	running map[string]map[uint64]context.CancelFunc
	seen    atomic.Int64
}

func (s *session) send(v any) {
	select {
	case s.out <- v:
	case <-s.ctx.Done():
	}
}

func (s *session) track(device string, id uint64, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[device] == nil {
		s.running[device] = map[uint64]context.CancelFunc{}
	}
	s.running[device][id] = cancel
}

func (s *session) untrack(device string, id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.running[device], id)
}

func (s *session) cancelDevice(device string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, cancel := range s.running[device] {
		cancel()
	}
	delete(s.running, device)
}

func (s *session) cancelAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, byID := range s.running {
		for _, cancel := range byID {
			cancel()
		}
	}
	s.running = map[string]map[uint64]context.CancelFunc{}
}

func (c *Client) session(parent context.Context) error {
	conn, err := dial(parent, c.Server)
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	if err := writeJSON(ctx, conn, wire.NewHello(c.Token, c.Version, c.Caps)); err != nil {
		return err
	}
	if _, err := expectWelcome(ctx, conn); err != nil {
		return err
	}
	if c.OnState != nil {
		c.OnState(true, nil)
	}
	s := &session{conn: conn, ctx: ctx, out: make(chan any, 64), running: map[string]map[uint64]context.CancelFunc{}}
	s.seen.Store(time.Now().UnixNano())
	c.H.SetEmitter(s.send)
	defer c.H.SetEmitter(nil)

	errs := make(chan error, 3)
	// Writer: the only goroutine that writes to the socket.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case v := <-s.out:
				if err := writeJSON(ctx, conn, v); err != nil {
					errs <- err
					return
				}
			}
		}
	}()
	s.send(c.H.Inventory())
	// Keepalive + idle close + inventory changes.
	go func() {
		ping := time.NewTicker(wire.PingSecs * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ping.C:
				if time.Since(time.Unix(0, s.seen.Load())) > wire.IdleCloseSecs*time.Second {
					errs <- errors.New("relay silent for 60 s")
					return
				}
				s.send(wire.Ping)
			case <-c.H.Changes():
				s.send(c.H.Inventory())
			}
		}
	}()
	// Reader.
	go func() {
		for {
			f, err := readFrame(ctx, conn)
			if err != nil {
				errs <- err
				return
			}
			s.seen.Store(time.Now().UnixNano())
			switch f.Type {
			case wire.TypeRequest:
				c.handle(s, f)
			case wire.TypeStop:
				s.cancelDevice(f.Device)
				c.H.Stop(f.Device)
			case wire.TypeError:
				if f.Code == "DEVICE_REVOKED" {
					errs <- ErrRevoked
				} else {
					errs <- fmt.Errorf("relay error %s", f.Code)
				}
				return
			}
		}
	}()
	err = <-errs
	cancel()
	s.cancelAll()
	return err
}

func (c *Client) handle(s *session, f wire.Outbound) {
	rctx, cancel := context.WithCancel(s.ctx)
	s.track(f.Device, f.ID, cancel)
	go func() {
		defer cancel()
		defer s.untrack(f.Device, f.ID)
		result, err := c.H.Handle(rctx, f.Device, f.Verb, f.Args)
		if err != nil {
			var ve *wire.VerbError
			if errors.As(err, &ve) {
				s.send(wire.Fail(f.ID, ve.Code, ve.Message))
			} else if rctx.Err() != nil {
				s.send(wire.Fail(f.ID, wire.ErrFailed, "stopped"))
			} else {
				s.send(wire.Fail(f.ID, wire.ErrFailed, err.Error()))
			}
			return
		}
		if result == nil {
			result = map[string]any{}
		}
		s.send(wire.OK(f.ID, result))
	}()
}
