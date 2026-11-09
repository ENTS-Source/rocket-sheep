package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestPM25State(t *testing.T) {
	tests := []struct {
		val      float64
		expected string
	}{
		{0.0, "GOOD"},
		{15.0, "GOOD"},
		{35.0, "GOOD"},
		{35.1, "OKAY"},
		{50.0, "OKAY"},
		{60.0, "OKAY"},
		{60.1, "BAD"},
		{80.0, "BAD"},
		{150.0, "BAD"},
	}
	for _, tc := range tests {
		got := pm25State(tc.val)
		if got != tc.expected {
			t.Errorf("pm25State(%f) = %q; want %q", tc.val, got, tc.expected)
		}
	}
}

func TestPM25Color(t *testing.T) {
	// 0 is Pure Green
	c0 := pm25Color(0)
	if c0 != (color.RGBA{34, 177, 76, 255}) {
		t.Fatalf("expected color at 0 to be green (34, 177, 76, 255), got %v", c0)
	}

	// 35 is Pure Yellow
	c35 := pm25Color(35)
	if c35 != (color.RGBA{255, 242, 0, 255}) {
		t.Fatalf("expected color at 35 to be yellow (255, 242, 0, 255), got %v", c35)
	}

	// 60 is Pure Red
	c60 := pm25Color(60)
	if c60 != (color.RGBA{237, 28, 36, 255}) {
		t.Fatalf("expected color at 60 to be red (237, 28, 36, 255), got %v", c60)
	}

	// >60 is Red
	c100 := pm25Color(100)
	if c100 != (color.RGBA{237, 28, 36, 255}) {
		t.Fatalf("expected color at 100 to be red (237, 28, 36, 255), got %v", c100)
	}

	// Intermediate 17.5 should have R between green and yellow
	c17 := pm25Color(17.5)
	if c17.R <= c0.R || c17.R >= c35.R {
		t.Fatalf("expected intermediate R to transition, got %d", c17.R)
	}

	// Intermediate 47.5 should have G between yellow and red
	c47 := pm25Color(47.5)
	if c47.G >= c35.G || c47.G <= c60.G {
		t.Fatalf("expected intermediate G to transition, got %d", c47.G)
	}
}

func TestFindPM25Value(t *testing.T) {
	sensors := []State{
		{EntityID: "sensor.living_room_temperature", State: "21.5", Attributes: map[string]any{"device_class": "temperature"}},
		{EntityID: "sensor.air_pm25", State: "12.4", Attributes: map[string]any{"device_class": "pm25"}},
	}
	val, ok := findPM25Value(sensors)
	if !ok || val != 12.4 {
		t.Fatalf("expected pm25 value 12.4, ok=true; got %v, %v", val, ok)
	}

	// No PM2.5 sensor
	noPM25 := []State{
		{EntityID: "sensor.living_room_temperature", State: "21.5", Attributes: map[string]any{"device_class": "temperature"}},
	}
	_, ok = findPM25Value(noPM25)
	if ok {
		t.Fatal("expected ok=false when pm25 is not present")
	}

	// Invalid state
	invalidPM25 := []State{
		{EntityID: "sensor.air_pm25", State: "unavailable", Attributes: map[string]any{"device_class": "pm25"}},
	}
	_, ok = findPM25Value(invalidPM25)
	if ok {
		t.Fatal("expected ok=false when pm25 state is unavailable")
	}
}

func TestDrawPM25Bar(t *testing.T) {
	dst := image.NewRGBA(image.Rect(0, 0, 100, 30))
	drawPM25Bar(dst, 10, 5, 80, 8, 35.0)

	// Check that the left of the bar is green-ish
	cLeft := dst.RGBAAt(10, 8)
	if cLeft.G <= cLeft.R {
		t.Fatalf("expected left pixel to be green dominant, got %v", cLeft)
	}

	// Check that the right of the bar is red-ish
	cRight := dst.RGBAAt(89, 8)
	if cRight.R <= cRight.G {
		t.Fatalf("expected right pixel to be red dominant, got %v", cRight)
	}

	// For val=35, indicator should be around x = 10 + round(0.35 * 79) = 10 + 28 = 38
	cIndicator := dst.RGBAAt(38, 8)
	if cIndicator != (color.RGBA{255, 255, 255, 255}) {
		t.Fatalf("expected indicator at x=38 to be white, got %v", cIndicator)
	}
}

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

func TestRenderNoHeader(t *testing.T) {
	// Create mock camera image
	camImg := image.NewRGBA(image.Rect(0, 0, 640, 360))
	var camBuf bytes.Buffer
	if err := jpeg.Encode(&camBuf, camImg, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write(camBuf.Bytes())
	}))
	defer ts.Close()

	bot := &Bot{
		cfg: Config{
			HAURL:       ts.URL,
			HAToken:     "mock_token",
			TileWidth:   640,
			TileHeight:  360,
			PixelsWide:  48,
			JPEGQuality: 65,
			MaxCameras:  12,
		},
		http: ts.Client(),
	}

	area := AreaInfo{
		Name: "Test Area",
		Cameras: []State{
			{EntityID: "camera.one", Attributes: map[string]any{"friendly_name": "Camera 1"}},
		},
	}

	jpgBytes, w, h, err := bot.render(context.Background(), area)
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}

	// For 1 camera: cols=1, rows=1.
	// w = 1*640 + 2*4 = 648
	// h = 1*(360+24) + 2*4 = 392 (previously was 392 + 56 = 448 with header)
	expectedW := 648
	expectedH := 392
	if w != expectedW || h != expectedH {
		t.Fatalf("expected dimensions %dx%d, got %dx%d", expectedW, expectedH, w, h)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(jpgBytes))
	if err != nil {
		t.Fatalf("failed to decode rendered jpeg: %v", err)
	}
	if decoded.Bounds().Dx() != expectedW || decoded.Bounds().Dy() != expectedH {
		t.Fatalf("decoded dimensions %dx%d mismatch expected %dx%d", decoded.Bounds().Dx(), decoded.Bounds().Dy(), expectedW, expectedH)
	}
}

func TestRenderWithSensorsAndPM25Bar(t *testing.T) {
	camImg := image.NewRGBA(image.Rect(0, 0, 640, 360))
	var camBuf bytes.Buffer
	if err := jpeg.Encode(&camBuf, camImg, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Write(camBuf.Bytes())
	}))
	defer ts.Close()

	bot := &Bot{
		cfg: Config{
			HAURL:       ts.URL,
			HAToken:     "mock_token",
			TileWidth:   640,
			TileHeight:  360,
			PixelsWide:  48,
			JPEGQuality: 65,
			MaxCameras:  12,
		},
		http: ts.Client(),
	}

	area := AreaInfo{
		Name: "Test Area",
		Cameras: []State{
			{EntityID: "camera.one", Attributes: map[string]any{"friendly_name": "Camera 1"}},
		},
		Sensors: []State{
			{EntityID: "sensor.temp", State: "21.0", Attributes: map[string]any{"device_class": "temperature", "unit_of_measurement": "°C"}},
			{EntityID: "sensor.hum", State: "50", Attributes: map[string]any{"device_class": "humidity", "unit_of_measurement": "%"}},
			{EntityID: "sensor.pm25", State: "15.0", Attributes: map[string]any{"device_class": "pm25", "unit_of_measurement": "µg/m³"}},
		},
	}

	jpgBytes, w, h, err := bot.render(context.Background(), area)
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	if len(jpgBytes) == 0 || w <= 0 || h <= 0 {
		t.Fatalf("invalid render output: len=%d, w=%d, h=%d", len(jpgBytes), w, h)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(jpgBytes))
	if err != nil {
		t.Fatalf("failed to decode rendered jpeg: %v", err)
	}
	if decoded.Bounds().Dx() != w || decoded.Bounds().Dy() != h {
		t.Fatalf("decoded dimensions %dx%d mismatch expected %dx%d", decoded.Bounds().Dx(), decoded.Bounds().Dy(), w, h)
	}
}
