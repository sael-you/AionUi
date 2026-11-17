package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/adb"
	"github.com/iOfficeAI/AionUi/packages/mac-helper/internal/wire"
)

// MaxAPKBytes bounds one install_apk download.
const MaxAPKBytes = 300 << 20

var sha256Pattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)

// HTTPClient downloads APKs (tests replace it).
var HTTPClient = &http.Client{Timeout: 10 * time.Minute}

// installAPK downloads an https APK, checks its sha256, then installs it.
func (a *Agent) installAPK(ctx context.Context, phone adb.Phone, rawURL, sum string) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return wire.Errorf(wire.ErrBadArgs, "url must be https")
	}
	if !sha256Pattern.MatchString(sum) {
		return wire.Errorf(wire.ErrBadArgs, "sha256 must be 64 hex characters")
	}
	path, err := download(ctx, u.String(), strings.ToLower(sum))
	if err != nil {
		return err
	}
	defer os.Remove(path)
	return phone.InstallAPK(ctx, path)
}

func download(ctx context.Context, rawURL, sum string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}
	f, err := os.CreateTemp("", "aionui-apk-*.apk")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, MaxAPKBytes+1))
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil && n > MaxAPKBytes {
		err = wire.Errorf(wire.ErrRefused, "APK larger than %d MB", MaxAPKBytes>>20)
	}
	if err == nil && hex.EncodeToString(h.Sum(nil)) != sum {
		err = wire.Errorf(wire.ErrRefused, "sha256 mismatch: not installed")
	}
	if err != nil {
		os.Remove(f.Name())
		var ve *wire.VerbError
		if errors.As(err, &ve) {
			return "", ve
		}
		return "", err
	}
	return f.Name(), nil
}
