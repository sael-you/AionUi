// Package audit keeps the helper's local log: one JSON line per verb with the
// device, outcome and duration. Arguments are summarised (coordinates, package
// names, text length), never copied: no typed text, screenshots or tokens.
package audit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// MaxBytes rotates the log to `helper.jsonl.1` beyond this size.
const MaxBytes = 5 << 20

// Entry is one log line.
type Entry struct {
	Time       time.Time         `json:"time"`
	Device     string            `json:"device,omitempty"`
	Verb       string            `json:"verb"`
	OK         bool              `json:"ok"`
	Error      string            `json:"error,omitempty"`
	DurationMs int64             `json:"duration_ms"`
	Detail     map[string]string `json:"detail,omitempty"`
}

// Log appends entries to <dir>/helper.jsonl (mode 0600).
type Log struct {
	mu   sync.Mutex
	path string
}

// Open prepares the log in dir.
func Open(dir string) (*Log, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Log{path: filepath.Join(dir, "helper.jsonl")}, nil
}

// Path is the log file.
func (l *Log) Path() string { return l.path }

// Write appends one entry; errors are dropped (the log never blocks a verb).
func (l *Log) Write(e Entry) {
	if e.Time.IsZero() {
		e.Time = time.Now().UTC()
	}
	line, err := json.Marshal(e)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if info, err := os.Stat(l.path); err == nil && info.Size()+int64(len(line)) > MaxBytes {
		_ = os.Rename(l.path, l.path+".1")
	}
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}
