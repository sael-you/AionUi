package cdp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

type fwdRunner struct {
	mu    sync.Mutex
	port  string
	calls []string
}

func (f *fwdRunner) Run(_ context.Context, args ...string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, strings.Join(args, " "))
	if args[len(args)-1] == "localabstract:chrome_devtools_remote" {
		return []byte(f.port + "\n"), nil
	}
	return nil, nil
}

// fakeChrome answers /json/version (with a foreign host it must ignore) and
// echoes frames on the browser socket.
func fakeChrome(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/json/version", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"webSocketDebuggerUrl":"ws://evil.example:9222/devtools/browser/abc"}`))
	})
	mux.HandleFunc("/devtools/browser/abc", func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		for {
			_, raw, err := conn.Read(r.Context())
			if err != nil {
				return
			}
			_ = conn.Write(r.Context(), websocket.MessageText, append([]byte(`{"echo":`), append(raw, '}')...))
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestTunnelForwardsExactFramesAsStrings(t *testing.T) {
	chrome := fakeChrome(t)
	u, _ := url.Parse(chrome.URL)
	r := &fwdRunner{port: u.Port()}
	m := NewManager(r)
	events := make(chan wire.Event, 4)
	m.SetEmit(func(f any) { events <- f.(wire.Event) })
	session, err := m.Open(context.Background(), "S1")
	if err != nil {
		t.Fatal(err)
	}
	msg := `{"id":1,"method":"Target.getTargets"}`
	if err := m.Frame(session, []byte(msg)); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-events:
		data := ev.Data.(map[string]string)
		if ev.Name != wire.EventCDPFrame || ev.Device != "S1" || data["session"] != session || data["message"] != `{"echo":`+msg+`}` {
			t.Fatalf("event %+v", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no frame back")
	}
	if err := m.Close(session); err != nil {
		t.Fatal(err)
	}
	if err := m.Frame(session, []byte("{}")); err == nil {
		t.Fatal("frame after close accepted")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !strings.Contains(strings.Join(r.calls, "\n"), "forward --remove tcp:"+u.Port()) {
		t.Fatalf("forward not removed: %v", r.calls)
	}
}

func TestCloseDeviceEmitsClosed(t *testing.T) {
	chrome := fakeChrome(t)
	u, _ := url.Parse(chrome.URL)
	m := NewManager(&fwdRunner{port: u.Port()})
	events := make(chan wire.Event, 4)
	m.SetEmit(func(f any) { events <- f.(wire.Event) })
	session, err := m.Open(context.Background(), "S1")
	if err != nil {
		t.Fatal(err)
	}
	m.CloseDevice("S1")
	select {
	case ev := <-events:
		if ev.Name != wire.EventCDPClosed || ev.Data.(map[string]string)["session"] != session {
			t.Fatalf("event %+v", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no cdp_closed")
	}
}
