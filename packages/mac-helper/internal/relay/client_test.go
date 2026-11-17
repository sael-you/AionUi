package relay

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

type fakeHandler struct {
	mu       sync.Mutex
	stopped  []string
	changes  chan struct{}
	emit     func(any)
	blocking chan struct{}
	canceled chan struct{}
}

func newFake() *fakeHandler {
	return &fakeHandler{changes: make(chan struct{}, 1), blocking: make(chan struct{}), canceled: make(chan struct{}, 1)}
}

func (f *fakeHandler) Handle(ctx context.Context, device, verb string, args json.RawMessage) (any, error) {
	switch verb {
	case "tap":
		var a struct{ X, Y int }
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, wire.Errorf(wire.ErrBadArgs, "%v", err)
		}
		return nil, nil
	case "foreground":
		return map[string]string{"package": "com.android.chrome"}, nil
	case "slow":
		<-ctx.Done()
		f.canceled <- struct{}{}
		return nil, ctx.Err()
	}
	return nil, wire.Errorf(wire.ErrRefused, "unknown verb %s", verb)
}
func (f *fakeHandler) Stop(device string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped = append(f.stopped, device)
}
func (f *fakeHandler) Inventory() wire.Inventory {
	return wire.NewInventory([]wire.Phone{{Serial: "S1", Name: "Pixel 8", Enabled: true}}, nil, nil)
}
func (f *fakeHandler) Changes() <-chan struct{} { return f.changes }
func (f *fakeHandler) SetEmitter(e func(any)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.emit = e
}

// fakeCore is a scripted relay endpoint.
type fakeCore struct {
	t      *testing.T
	origin chan string
	frames chan map[string]any
	script func(ctx context.Context, conn *websocket.Conn, read func() map[string]any)
}

func (fc *fakeCore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != wire.Path {
		http.NotFound(w, r)
		return
	}
	fc.origin <- r.Header.Get("Origin")
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	ctx := r.Context()
	read := func() map[string]any {
		rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		for {
			_, raw, err := conn.Read(rctx)
			if err != nil {
				return nil
			}
			var m map[string]any
			_ = json.Unmarshal(raw, &m)
			if m["type"] == "ping" {
				continue
			}
			return m
		}
	}
	fc.script(ctx, conn, read)
}

func send(ctx context.Context, conn *websocket.Conn, v any) {
	raw, _ := json.Marshal(v)
	_ = conn.Write(ctx, websocket.MessageText, raw)
}

func start(t *testing.T, script func(ctx context.Context, conn *websocket.Conn, read func() map[string]any)) (*httptest.Server, *fakeCore) {
	fc := &fakeCore{t: t, origin: make(chan string, 4), script: script}
	srv := httptest.NewServer(fc)
	t.Cleanup(srv.Close)
	return srv, fc
}

func TestPairStoresTokenFromWelcome(t *testing.T) {
	srv, fc := start(t, func(ctx context.Context, conn *websocket.Conn, read func() map[string]any) {
		m := read()
		if m["type"] != "pair" || m["code"] != "ABC123" || m["kind"] != "mac_helper" {
			send(ctx, conn, map[string]any{"type": "error", "code": "DEVICE_BAD_MESSAGE"})
			return
		}
		send(ctx, conn, map[string]any{"type": "welcome", "client_id": "c1", "token": "tok"})
	})
	id, token, err := Pair(context.Background(), srv.URL, "ABC123", "Mac", "0.1.0", []string{"tap"})
	if err != nil || id != "c1" || token != "tok" {
		t.Fatalf("pair: %q %q %v", id, token, err)
	}
	if origin := <-fc.origin; origin != "" {
		t.Fatalf("Origin header sent: %q", origin)
	}
}

func TestPairRefused(t *testing.T) {
	srv, _ := start(t, func(ctx context.Context, conn *websocket.Conn, read func() map[string]any) {
		read()
		send(ctx, conn, map[string]any{"type": "error", "code": "DEVICE_PAIRING_INVALID"})
	})
	if _, _, err := Pair(context.Background(), srv.URL, "BAD", "Mac", "0.1.0", nil); !errors.Is(err, ErrPairing) {
		t.Fatalf("err %v", err)
	}
}

func TestSessionHelloInventoryRequestsAndStop(t *testing.T) {
	results := make(chan []map[string]any, 1)
	srv, _ := start(t, func(ctx context.Context, conn *websocket.Conn, read func() map[string]any) {
		var got []map[string]any
		hello := read()
		if hello["type"] != "hello" || hello["token"] != "tok" {
			results <- []map[string]any{hello}
			return
		}
		send(ctx, conn, map[string]any{"type": "welcome", "client_id": "c1"})
		got = append(got, read()) // inventory
		send(ctx, conn, map[string]any{"type": "request", "id": 1, "device": "S1", "verb": "foreground", "args": map[string]any{}})
		got = append(got, read())
		send(ctx, conn, map[string]any{"type": "request", "id": 2, "device": "S1", "verb": "tap", "args": "nope"})
		got = append(got, read())
		send(ctx, conn, map[string]any{"type": "request", "id": 3, "device": "S1", "verb": "slow", "args": map[string]any{}})
		time.Sleep(100 * time.Millisecond)
		send(ctx, conn, map[string]any{"type": "stop", "device": "S1"})
		got = append(got, read())
		results <- got
		send(ctx, conn, map[string]any{"type": "error", "code": "DEVICE_REVOKED"})
	})
	h := newFake()
	c := &Client{Server: srv.URL, Token: "tok", Version: "0.1.0", H: h, MaxBackoff: 10 * time.Millisecond}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()
	got := <-results
	if len(got) != 4 {
		t.Fatalf("frames %v", got)
	}
	if got[0]["type"] != "inventory" || len(got[0]["phones"].([]any)) != 1 {
		t.Errorf("inventory %v", got[0])
	}
	if got[1]["ok"] != true || got[1]["result"].(map[string]any)["package"] != "com.android.chrome" {
		t.Errorf("foreground %v", got[1])
	}
	if got[2]["ok"] != false || got[2]["error"].(map[string]any)["code"] != wire.ErrBadArgs {
		t.Errorf("bad args %v", got[2])
	}
	if got[3]["id"] != float64(3) || got[3]["ok"] != false {
		t.Errorf("stopped request %v", got[3])
	}
	select {
	case <-h.canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("stop did not cancel the running verb")
	}
	if err := <-done; !errors.Is(err, ErrRevoked) {
		t.Fatalf("run ended with %v, want ErrRevoked", err)
	}
	if len(h.stopped) != 1 || h.stopped[0] != "S1" {
		t.Fatalf("handler stop %v", h.stopped)
	}
}

func TestURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://y.talkseeds.com": "wss://y.talkseeds.com/api/devices/relay",
		"http://localhost:25809":  "ws://localhost:25809/api/devices/relay",
	} {
		if got, err := URL(in); err != nil || got != want {
			t.Errorf("URL(%q) = %q %v", in, got, err)
		}
	}
}
