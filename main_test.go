package main

import (
	"image"
	"image/color"
	"os"
	"testing"
)

func TestPixelationReducesDetail(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 640, 360))
	for y := 0; y < 360; y++ {
		for x := 0; x < 640; x++ {
			if x%2 == 0 {
				src.Set(x, y, color.White)
			} else {
				src.Set(x, y, color.Black)
			}
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, 640, 360))
	pixelateCover(dst, dst.Bounds(), src, 40)
	// Every image region spanning fewer than 16 horizontal pixels should have
	// precisely the same colour if pixelation was applied.
	for y := 0; y < 360; y += 11 {
		for x := 0; x < 624; x += 16 {
			if dst.RGBAAt(x, y) != dst.RGBAAt(x+15, y) {
				t.Fatalf("tile not blocky at %d,%d", x, y)
			}
		}
	}
}
func TestAreaSensorOverlay(t *testing.T) {
	area := AreaInfo{Sensors: []State{
		{EntityID: "sensor.one", State: "23.0", Attributes: map[string]any{"device_class": "temperature", "unit_of_measurement": "°C"}},
		{EntityID: "sensor.two", State: "43", Attributes: map[string]any{"device_class": "humidity", "unit_of_measurement": "%"}},
		{EntityID: "sensor.three", State: "7.8", Attributes: map[string]any{"device_class": "pm25", "unit_of_measurement": "µg/m³"}},
	}}
	lines := sensorLines(area)
	if len(lines) != 3 {
		t.Fatalf("wanted 3 sensor lines, got %v", lines)
	}
}

func TestPixelation256(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 640, 360))
	for y := 0; y < 360; y++ {
		for x := 0; x < 640; x++ {
			if x%2 == 0 {
				src.Set(x, y, color.White)
			} else {
				src.Set(x, y, color.Black)
			}
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, 640, 360))
	pixelateCover(dst, dst.Bounds(), src, 256)
	// With 256 pixels wide on 640 width, each coarse pixel spans 640/256 = 2.5 pixels.
	// Adjacent pairs of pixels inside the same block (e.g., at x=0 and x=1) should have identical color.
	if dst.RGBAAt(0, 0) != dst.RGBAAt(1, 0) {
		t.Fatalf("expected pixels in coarse block to match, got %v and %v", dst.RGBAAt(0, 0), dst.RGBAAt(1, 0))
	}
}

func TestConfigPrivacyPixelsWideValidation(t *testing.T) {
	validJSON := `{
		"matrix_url": "https://matrix.org",
		"matrix_token": "token",
		"matrix_user": "@bot:matrix.org",
		"home_assistant_url": "http://homeassistant.local:8123",
		"home_assistant_token": "token",
		"allowed_rooms": ["!room:matrix.org"],
		"privacy_pixels_wide": 256
	}`
	f, err := os.CreateTemp("", "config_*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(validJSON); err != nil {
		t.Fatal(err)
	}
	f.Close()

	cfg, err := loadConfig(f.Name())
	if err != nil {
		t.Fatalf("expected config with privacy_pixels_wide=256 to be valid, got error: %v", err)
	}
	if cfg.PixelsWide != 256 {
		t.Fatalf("expected PixelsWide to be 256, got %d", cfg.PixelsWide)
	}

	invalidJSON := `{
		"matrix_url": "https://matrix.org",
		"matrix_token": "token",
		"matrix_user": "@bot:matrix.org",
		"home_assistant_url": "http://homeassistant.local:8123",
		"home_assistant_token": "token",
		"allowed_rooms": ["!room:matrix.org"],
		"privacy_pixels_wide": 257
	}`
	f2, err := os.CreateTemp("", "config_invalid_*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f2.Name())
	if _, err := f2.WriteString(invalidJSON); err != nil {
		t.Fatal(err)
	}
	f2.Close()

	if _, err := loadConfig(f2.Name()); err == nil {
		t.Fatal("expected config with privacy_pixels_wide=257 to fail validation, got nil error")
	}
}
