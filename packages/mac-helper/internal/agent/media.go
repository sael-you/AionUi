package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
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

// Screenshot is the W2 screenshot result.
type Screenshot struct {
	Format     string `json:"format"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DataBase64 string `json:"data_base64"`
}

// EncodeScreenshot returns the PNG as is (scale 1) or a downscaled JPEG q80.
func EncodeScreenshot(pngBytes []byte, scale float64) (Screenshot, error) {
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return Screenshot{}, fmt.Errorf("decode screenshot: %w", err)
	}
	b := img.Bounds()
	if scale >= 1 {
		return Screenshot{Format: "png", Width: b.Dx(), Height: b.Dy(), DataBase64: base64.StdEncoding.EncodeToString(pngBytes)}, nil
	}
	small := downscale(img, scale)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, small, &jpeg.Options{Quality: 80}); err != nil {
		return Screenshot{}, err
	}
	sb := small.Bounds()
	return Screenshot{Format: "jpeg", Width: sb.Dx(), Height: sb.Dy(), DataBase64: base64.StdEncoding.EncodeToString(out.Bytes())}, nil
}

// downscale averages source pixels per target pixel (box filter).
func downscale(src image.Image, scale float64) *image.RGBA {
	b := src.Bounds()
	w := max(1, int(float64(b.Dx())*scale))
	h := max(1, int(float64(b.Dy())*scale))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		y0 := b.Min.Y + y*b.Dy()/h
		y1 := max(y0+1, b.Min.Y+(y+1)*b.Dy()/h)
		for x := 0; x < w; x++ {
			x0 := b.Min.X + x*b.Dx()/w
			x1 := max(x0+1, b.Min.X+(x+1)*b.Dx()/w)
			var r, g, bl, al, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					cr, cg, cb, ca := src.At(sx, sy).RGBA()
					r, g, bl, al, n = r+uint64(cr), g+uint64(cg), bl+uint64(cb), al+uint64(ca), n+1
				}
			}
			i := dst.PixOffset(x, y)
			dst.Pix[i+0] = uint8(r / n >> 8)
			dst.Pix[i+1] = uint8(g / n >> 8)
			dst.Pix[i+2] = uint8(bl / n >> 8)
			dst.Pix[i+3] = uint8(al / n >> 8)
		}
	}
	return dst
}

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
