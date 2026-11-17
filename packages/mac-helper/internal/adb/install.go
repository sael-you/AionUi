package adb

import (
	"archive/zip"
	"context"
	"crypto/sha1" //nolint:gosec // Google publishes only sha1 for SDK archives; size is checked too.
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RepositoryURL is Google's SDK repository index (stable channel = channel-0).
const RepositoryURL = "https://dl.google.com/android/repository/repository2-3.xml"

// LicenseURL is shown before the download: the owner accepts it, not us.
const LicenseURL = "https://developer.android.com/studio/terms"

// Archive is one platform-tools download.
type Archive struct {
	Version string
	URL     string
	Size    int64
	SHA1    string
}

type repository struct {
	Packages []struct {
		Path     string `xml:"path,attr"`
		Revision struct {
			Major int `xml:"major"`
			Minor int `xml:"minor"`
			Micro int `xml:"micro"`
		} `xml:"revision"`
		Channel struct {
			Ref string `xml:"ref,attr"`
		} `xml:"channelRef"`
		Archives []struct {
			HostOS   string `xml:"host-os"`
			Complete struct {
				Size     int64  `xml:"size"`
				Checksum string `xml:"checksum"`
				URL      string `xml:"url"`
			} `xml:"complete"`
		} `xml:"archives>archive"`
	} `xml:"remotePackage"`
}

// FindArchive picks the stable platform-tools archive for a host OS
// ("macosx", "linux") from the repository index.
func FindArchive(index []byte, hostOS string) (Archive, error) {
	var repo repository
	if err := xml.Unmarshal(index, &repo); err != nil {
		return Archive{}, err
	}
	for _, p := range repo.Packages {
		if p.Path != "platform-tools" || p.Channel.Ref != "channel-0" {
			continue
		}
		for _, a := range p.Archives {
			if a.HostOS != hostOS || strings.Contains(a.Complete.URL, "/") {
				continue
			}
			return Archive{
				Version: fmt.Sprintf("%d.%d.%d", p.Revision.Major, p.Revision.Minor, p.Revision.Micro),
				URL:     "https://dl.google.com/android/repository/" + a.Complete.URL,
				Size:    a.Complete.Size,
				SHA1:    strings.ToLower(a.Complete.Checksum),
			}, nil
		}
	}
	return Archive{}, fmt.Errorf("no stable platform-tools for %s in the index", hostOS)
}

var client = &http.Client{Timeout: 10 * time.Minute}

func fetch(ctx context.Context, url string, w io.Writer, limit int64) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("GET %s: HTTP %d", url, resp.StatusCode)
	}
	return io.Copy(w, io.LimitReader(resp.Body, limit+1))
}

// InstallPlatformTools downloads, verifies and unpacks platform-tools into
// <stateDir>/platform-tools. Returns the installed version.
func InstallPlatformTools(ctx context.Context, stateDir, hostOS string) (string, error) {
	var index strings.Builder
	if _, err := fetch(ctx, RepositoryURL, &index, 32<<20); err != nil {
		return "", err
	}
	arc, err := FindArchive([]byte(index.String()), hostOS)
	if err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(stateDir, ".platform-tools-*.zip")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	h := sha1.New() //nolint:gosec
	n, err := fetch(ctx, arc.URL, io.MultiWriter(tmp, h), arc.Size)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", err
	}
	if n != arc.Size || hex.EncodeToString(h.Sum(nil)) != arc.SHA1 {
		return "", errors.New("platform-tools download does not match Google's size/checksum: not installed")
	}
	dest := filepath.Join(stateDir, "platform-tools")
	staging := dest + ".new"
	_ = os.RemoveAll(staging)
	if err := unzip(tmp.Name(), staging); err != nil {
		_ = os.RemoveAll(staging)
		return "", err
	}
	_ = os.RemoveAll(dest)
	if err := os.Rename(filepath.Join(staging, "platform-tools"), dest); err != nil {
		return "", err
	}
	_ = os.RemoveAll(staging)
	return arc.Version, nil
}

// unzip extracts an archive, refusing entries that escape dest.
func unzip(path, dest string) error {
	r, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer r.Close()
	root, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	for _, f := range r.File {
		target := filepath.Join(root, f.Name)
		if target != root && !strings.HasPrefix(target, root+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes the target: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in archive refused: %s", f.Name)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := extract(f, target); err != nil {
			return err
		}
	}
	return nil
}

func extract(f *zip.File, target string) error {
	src, err := f.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	mode := os.FileMode(0o644)
	if f.Mode()&0o111 != 0 {
		mode = 0o755
	}
	dst, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, io.LimitReader(src, 256<<20)); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}
