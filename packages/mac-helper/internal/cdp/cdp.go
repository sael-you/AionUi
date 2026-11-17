// Package cdp tunnels a phone Chrome's DevTools socket to AionCore (W2
// `cdp_open` / `cdp_frame` / `cdp_close`): `adb forward tcp:0
// localabstract:chrome_devtools_remote`, then the browser-level WebSocket
// from /json/version. CDP frames travel as JSON-encoded strings, exact bytes.
package cdp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/adb"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// MaxSessionsPerPhone bounds open tunnels.
const MaxSessionsPerPhone = 4

type session struct {
	serial string
	port   int
	conn   *websocket.Conn
	cancel context.CancelFunc
}

// Manager implements agent.CDP.
type Manager struct {
	R    adb.Runner
	Emit func(frame any)

	mu       sync.Mutex
	sessions map[string]*session
}

// NewManager builds a Manager; emit sends W2 events (set later is fine).
func NewManager(r adb.Runner) *Manager {
	return &Manager{R: r, sessions: map[string]*session{}}
}

func (m *Manager) emit(frame any) {
	m.mu.Lock()
	e := m.Emit
	m.mu.Unlock()
	if e != nil {
		e(frame)
	}
}

// SetEmit sets the event sink.
func (m *Manager) SetEmit(e func(any)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Emit = e
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "cdp-" + hex.EncodeToString(b)
}

// Open forwards the phone's DevTools socket and connects to the browser target.
func (m *Manager) Open(ctx context.Context, serial string) (string, error) {
	m.mu.Lock()
	count := 0
	for _, s := range m.sessions {
		if s.serial == serial {
			count++
		}
	}
	m.mu.Unlock()
	if count >= MaxSessionsPerPhone {
		return "", wire.Errorf(wire.ErrBusy, "%d Chrome sessions already open on this phone", count)
	}
	fctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := m.R.Run(fctx, "-s", serial, "forward", "tcp:0", "localabstract:chrome_devtools_remote")
	if err != nil {
		return "", err
	}
	port, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil || port <= 0 || port > 65535 {
		return "", fmt.Errorf("adb forward returned %q", strings.TrimSpace(string(out)))
	}
	conn, err := m.connect(fctx, port)
	if err != nil {
		m.removeForward(serial, port)
		return "", err
	}
	id := newID()
	sctx, scancel := context.WithCancel(context.Background())
	s := &session{serial: serial, port: port, conn: conn, cancel: scancel}
	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()
	go m.pump(sctx, id, s)
	return id, nil
}

// browserURL reads webSocketDebuggerUrl and pins it to the forwarded port.
func browserURL(ctx context.Context, port int) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+strconv.Itoa(port)+"/json/version", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Chrome is not answering (open Chrome on the phone): %w", err)
	}
	defer resp.Body.Close()
	var v struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&v); err != nil || v.WebSocketDebuggerURL == "" {
		return "", errors.New("no browser target in /json/version")
	}
	u, err := url.Parse(v.WebSocketDebuggerURL)
	if err != nil || !strings.HasPrefix(u.Path, "/devtools/browser/") {
		return "", errors.New("unexpected webSocketDebuggerUrl")
	}
	// Never follow a host from the phone: always our loopback forward.
	return "ws://127.0.0.1:" + strconv.Itoa(port) + u.Path, nil
}

func (m *Manager) connect(ctx context.Context, port int) (*websocket.Conn, error) {
	u, err := browserURL(ctx, port)
	if err != nil {
		return nil, err
	}
	conn, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(wire.MaxFrameBytes)
	return conn, nil
}

// pump forwards Chrome → AionCore frames until the socket closes.
func (m *Manager) pump(ctx context.Context, id string, s *session) {
	defer m.finish(id, true)
	for {
		_, raw, err := s.conn.Read(ctx)
		if err != nil {
			return
		}
		m.emit(wire.NewEvent(s.serial, wire.EventCDPFrame, map[string]string{"session": id, "message": string(raw)}))
	}
}

func (m *Manager) finish(id string, notify bool) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if !ok {
		return
	}
	s.cancel()
	_ = s.conn.Close(websocket.StatusNormalClosure, "closed")
	m.removeForward(s.serial, s.port)
	if notify {
		m.emit(wire.NewEvent(s.serial, wire.EventCDPClosed, map[string]string{"session": id}))
	}
}

func (m *Manager) removeForward(serial string, port int) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = m.R.Run(ctx, "-s", serial, "forward", "--remove", "tcp:"+strconv.Itoa(port))
}

// Frame sends one CDP frame (exact bytes) to Chrome.
func (m *Manager) Frame(id string, message []byte) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return wire.Errorf(wire.ErrBadArgs, "no such CDP session")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.conn.Write(ctx, websocket.MessageText, message)
}

// Close ends a session (no cdp_closed event: core asked for it).
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	_, ok := m.sessions[id]
	m.mu.Unlock()
	if !ok {
		return wire.Errorf(wire.ErrBadArgs, "no such CDP session")
	}
	m.finish(id, false)
	return nil
}

// CloseDevice ends every session on a phone (stop, switch off, unplugged).
func (m *Manager) CloseDevice(serial string) {
	m.mu.Lock()
	var ids []string
	for id, s := range m.sessions {
		if s.serial == serial {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.finish(id, true)
	}
}
