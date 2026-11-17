package macos

import (
	"encoding/xml"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestAppleScriptString(t *testing.T) {
	got := AppleScriptString("say \"hi\" \\ then\nquit")
	if got != `"say \"hi\" \\ then quit"` {
		t.Fatalf("%s", got)
	}
}

func TestPlistIsValidXMLWithEscapedPaths(t *testing.T) {
	p := Plist("/Users/a & b/aionui-mac-helper", "/Users/a & b/state")
	dec := xml.NewDecoder(strings.NewReader(p))
	dec.Strict = true
	for {
		_, err := dec.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			t.Fatalf("invalid plist: %v", err)
		}
	}
	if !strings.Contains(p, "<string>/Users/a &amp; b/aionui-mac-helper</string><string>run</string>") {
		t.Fatalf("program arguments: %s", p)
	}
	if !strings.Contains(p, "<string>"+Label+"</string>") || !strings.Contains(p, "<key>KeepAlive</key><true/>") {
		t.Fatal("label/keepalive missing")
	}
}
