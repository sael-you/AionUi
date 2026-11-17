// Package shot encodes screenshots for W2: the PNG as captured, or a
// downscaled JPEG (q80) — phone `screenshot{scale}` and the Mac's
// `mac_screenshot` (scaled to display points so clicks match).
package shot

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
)

// Screenshot is the W2 screenshot result.
type Screenshot struct {
	Format     string `json:"format"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DataBase64 string `json:"data_base64"`
}

// EncodeScreenshot returns the PNG as is (scale 1) or a downscaled JPEG q80.
func Encode(pngBytes []byte, scale float64) (Screenshot, error) {
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

// downscale averages source pixels per target pixel (box filter). RGBA and
// NRGBA images (what PNG screenshots decode to) take a fast path over Pix.
func downscale(src image.Image, scale float64) *image.RGBA {
	b := src.Bounds()
	w := max(1, int(float64(b.Dx())*scale))
	h := max(1, int(float64(b.Dy())*scale))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	var pix []uint8
	var stride int
	switch img := src.(type) {
	case *image.RGBA:
		pix, stride = img.Pix, img.Stride
	case *image.NRGBA:
		pix, stride = img.Pix, img.Stride
	}
	for y := 0; y < h; y++ {
		y0 := b.Min.Y + y*b.Dy()/h
		y1 := max(y0+1, b.Min.Y+(y+1)*b.Dy()/h)
		for x := 0; x < w; x++ {
			x0 := b.Min.X + x*b.Dx()/w
			x1 := max(x0+1, b.Min.X+(x+1)*b.Dx()/w)
			var r, g, bl, al, n uint64
			for sy := y0; sy < y1; sy++ {
				if pix != nil {
					row := (sy-b.Min.Y)*stride + (x0-b.Min.X)*4
					for i := row; i < row+(x1-x0)*4; i += 4 {
						r, g, bl, al = r+uint64(pix[i]), g+uint64(pix[i+1]), bl+uint64(pix[i+2]), al+uint64(pix[i+3])
					}
					n += uint64(x1 - x0)
					continue
				}
				for sx := x0; sx < x1; sx++ {
					cr, cg, cb, ca := src.At(sx, sy).RGBA()
					r, g, bl, al, n = r+uint64(cr>>8), g+uint64(cg>>8), bl+uint64(cb>>8), al+uint64(ca>>8), n+1
				}
			}
			i := dst.PixOffset(x, y)
			dst.Pix[i+0] = uint8(r / n)
			dst.Pix[i+1] = uint8(g / n)
			dst.Pix[i+2] = uint8(bl / n)
			dst.Pix[i+3] = uint8(al / n)
		}
	}
	return dst
}

// EncodeToWidth scales a PNG down to width (when it is wider), else keeps it.
func EncodeToWidth(pngBytes []byte, width int) (Screenshot, error) {
	cfg, err := png.DecodeConfig(bytes.NewReader(pngBytes))
	if err != nil {
		return Screenshot{}, fmt.Errorf("decode screenshot: %w", err)
	}
	if width <= 0 || cfg.Width <= width {
		return Encode(pngBytes, 1)
	}
	return Encode(pngBytes, float64(width)/float64(cfg.Width))
}
