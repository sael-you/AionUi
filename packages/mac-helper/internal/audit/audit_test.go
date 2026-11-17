package audit

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestWriteAppendsJSONLinesWithMode0600(t *testing.T) {
	l, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	l.Write(Entry{Device: "S1", Verb: "tap", OK: true, Detail: map[string]string{"x": "1"}})
	l.Write(Entry{Device: "S1", Verb: "text", OK: false, Error: "switch_off"})
	info, err := os.Stat(l.Path())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v err %v", info.Mode().Perm(), err)
	}
	f, _ := os.Open(l.Path())
	defer f.Close()
	var lines []Entry
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var e Entry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, e)
	}
	if len(lines) != 2 || lines[0].Verb != "tap" || lines[1].Error != "switch_off" || lines[0].Time.IsZero() {
		t.Fatalf("lines %+v", lines)
	}
}

func TestRotatesPastMaxBytes(t *testing.T) {
	l, _ := Open(t.TempDir())
	big := strings.Repeat("x", 1<<20)
	for i := 0; i < 6; i++ {
		l.Write(Entry{Verb: "v", Error: big})
	}
	if _, err := os.Stat(l.Path() + ".1"); err != nil {
		t.Fatal("no rotation")
	}
	if info, _ := os.Stat(l.Path()); info.Size() > MaxBytes {
		t.Fatalf("log %d bytes", info.Size())
	}
}
