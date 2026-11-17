package shot

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func pngOf(img image.Image) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestDownscaleAveragesBothPaths(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			if x%2 == 0 {
				src.Set(x, y, color.NRGBA{200, 100, 0, 255})
			}
		}
	}
	gray := image.NewGray(src.Bounds())
	for _, img := range []image.Image{src, gray} {
		out := downscale(img, 0.5)
		if out.Bounds().Dx() != 2 || out.Bounds().Dy() != 1 {
			t.Fatalf("size %v", out.Bounds())
		}
	}
	out := downscale(src, 0.5)
	if c := out.RGBAAt(0, 0); c.R != 100 || c.G != 50 || c.A != 127 {
		t.Fatalf("average %v", c)
	}
}

func TestEncodeToWidth(t *testing.T) {
	big := pngOf(image.NewRGBA(image.Rect(0, 0, 200, 100)))
	s, err := EncodeToWidth(big, 100)
	if err != nil || s.Format != "jpeg" || s.Width != 100 || s.Height != 50 {
		t.Fatalf("%+v %v", s.Format, err)
	}
	s, err = EncodeToWidth(big, 0)
	if err != nil || s.Format != "png" || s.Width != 200 {
		t.Fatalf("unknown width keeps the PNG: %+v %v", s.Format, err)
	}
}
