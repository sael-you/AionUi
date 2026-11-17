package adb

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const index = `<?xml version="1.0"?>
<sdk:sdk-repository xmlns:sdk="x" xmlns:xsi="y">
  <remotePackage path="platform-tools">
    <revision><major>37</major><minor>0</minor><micro>3</micro></revision>
    <channelRef ref="channel-2"/>
    <archives><archive><complete><size>1</size><checksum type="sha1">aa</checksum><url>platform-tools_r37.0.3-darwin.zip</url></complete><host-os>macosx</host-os></archive></archives>
  </remotePackage>
  <remotePackage path="platform-tools">
    <revision><major>37</major><minor>0</minor><micro>1</micro></revision>
    <channelRef ref="channel-0"/>
    <archives>
      <archive><complete><size>9</size><checksum type="sha1">BB</checksum><url>platform-tools_r37.0.1-linux.zip</url></complete><host-os>linux</host-os></archive>
      <archive><complete><size>16</size><checksum type="sha1">CC</checksum><url>platform-tools_r37.0.1-darwin.zip</url></complete><host-os>macosx</host-os></archive>
    </archives>
  </remotePackage>
</sdk:sdk-repository>`

func TestFindArchivePicksStableChannel(t *testing.T) {
	a, err := FindArchive([]byte(index), "macosx")
	if err != nil {
		t.Fatal(err)
	}
	if a.Version != "37.0.1" || a.SHA1 != "cc" || a.Size != 16 ||
		a.URL != "https://dl.google.com/android/repository/platform-tools_r37.0.1-darwin.zip" {
		t.Fatalf("%+v", a)
	}
	if _, err := FindArchive([]byte(index), "windows"); err == nil {
		t.Fatal("missing host accepted")
	}
}

func TestUnzipRefusesEscapes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.zip")
	f, _ := os.Create(path)
	w := zip.NewWriter(f)
	e, _ := w.Create("../evil")
	_, _ = e.Write([]byte("x"))
	_ = w.Close()
	_ = f.Close()
	err := unzip(path, filepath.Join(dir, "out"))
	if err == nil || !strings.Contains(err.Error(), "escapes") {
		t.Fatalf("err %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "evil")); err == nil {
		t.Fatal("file written outside the target")
	}
}
