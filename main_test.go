package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"math"
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

func TestPixelationNoCrop(t *testing.T) {
	// Case 1: Source is wider than destination (aspect ratio mismatch).
	// With crop-to-fill, left and right edges would be discarded.
	// Without crop, red on the left edge and blue on the right edge must be sampled into dst.
	srcWide := image.NewRGBA(image.Rect(0, 0, 200, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 20; x++ {
			srcWide.Set(x, y, color.RGBA{255, 0, 0, 255}) // Red left strip
		}
		for x := 20; x < 180; x++ {
			srcWide.Set(x, y, color.RGBA{0, 255, 0, 255}) // Green middle
		}
		for x := 180; x < 200; x++ {
			srcWide.Set(x, y, color.RGBA{0, 0, 255, 255}) // Blue right strip
		}
	}
	dstWide := image.NewRGBA(image.Rect(0, 0, 100, 100))
	pixelateCover(dstWide, dstWide.Bounds(), srcWide, 50)

	// Leftmost pixel (within vertically centered fit area at y=50) should be red (from left strip)
	leftColor := dstWide.RGBAAt(0, 50)
	if leftColor.R < 200 || leftColor.G > 50 || leftColor.B > 50 {
		t.Fatalf("expected left edge to be red (uncropped), got %v", leftColor)
	}
	// Rightmost pixel (within vertically centered fit area at y=50) should be blue (from right strip)
	rightColor := dstWide.RGBAAt(99, 50)
	if rightColor.B < 200 || rightColor.R > 50 || rightColor.G > 50 {
		t.Fatalf("expected right edge to be blue (uncropped), got %v", rightColor)
	}

	// Case 2: Source is taller than destination (aspect ratio mismatch).
	// With crop-to-fill, top and bottom edges would be discarded.
	// Without crop, red on the top edge and blue on the bottom edge must be sampled into dst.
	srcTall := image.NewRGBA(image.Rect(0, 0, 100, 200))
	for y := 0; y < 20; y++ {
		for x := 0; x < 100; x++ {
			srcTall.Set(x, y, color.RGBA{255, 0, 0, 255}) // Red top strip
		}
	}
	for y := 20; y < 180; y++ {
		for x := 0; x < 100; x++ {
			srcTall.Set(x, y, color.RGBA{0, 255, 0, 255}) // Green middle
		}
	}
	for y := 180; y < 200; y++ {
		for x := 0; x < 100; x++ {
			srcTall.Set(x, y, color.RGBA{0, 0, 255, 255}) // Blue bottom strip
		}
	}
	dstTall := image.NewRGBA(image.Rect(0, 0, 100, 100))
	pixelateCover(dstTall, dstTall.Bounds(), srcTall, 50)

	// Topmost pixel (within horizontally centered fit area at x=50) should be red (from top strip)
	topColor := dstTall.RGBAAt(50, 0)
	if topColor.R < 200 || topColor.G > 50 || topColor.B > 50 {
		t.Fatalf("expected top edge to be red (uncropped), got %v", topColor)
	}
	// Bottommost pixel (within horizontally centered fit area at x=50) should be blue (from bottom strip)
	bottomColor := dstTall.RGBAAt(50, 99)
	if bottomColor.B < 200 || bottomColor.R > 50 || bottomColor.G > 50 {
		t.Fatalf("expected bottom edge to be blue (uncropped), got %v", bottomColor)
	}
}

func TestPixelationNoWarp(t *testing.T) {
	// 2:1 aspect ratio source into 1:1 destination tile:
	// Output should be letterboxed with top and bottom black bars and centered 100x50 image.
	srcWide := image.NewRGBA(image.Rect(0, 0, 200, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 200; x++ {
			srcWide.Set(x, y, color.RGBA{255, 255, 255, 255}) // White image
		}
	}
	dstWide := image.NewRGBA(image.Rect(0, 0, 100, 100))
	pixelateCover(dstWide, dstWide.Bounds(), srcWide, 100)

	// Top letterbox bar (e.g. at y = 5) should be black
	topBarColor := dstWide.RGBAAt(50, 5)
	if topBarColor != (color.RGBA{0, 0, 0, 255}) {
		t.Fatalf("expected top bar to be black letterbox, got %v", topBarColor)
	}
	// Bottom letterbox bar (e.g. at y = 95) should be black
	bottomBarColor := dstWide.RGBAAt(50, 95)
	if bottomBarColor != (color.RGBA{0, 0, 0, 255}) {
		t.Fatalf("expected bottom bar to be black letterbox, got %v", bottomBarColor)
	}
	// Center (at y = 50) should be white
	centerColor := dstWide.RGBAAt(50, 50)
	if centerColor != (color.RGBA{255, 255, 255, 255}) {
		t.Fatalf("expected center to be white, got %v", centerColor)
	}

	// 1:2 aspect ratio source into 1:1 destination tile:
	// Output should be pillarboxed with left and right black bars and centered 50x100 image.
	srcTall := image.NewRGBA(image.Rect(0, 0, 100, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 100; x++ {
			srcTall.Set(x, y, color.RGBA{255, 255, 255, 255}) // White image
		}
	}
	dstTall := image.NewRGBA(image.Rect(0, 0, 100, 100))
	pixelateCover(dstTall, dstTall.Bounds(), srcTall, 100)

	// Left pillarbox bar (e.g. at x = 5) should be black
	leftBarColor := dstTall.RGBAAt(5, 50)
	if leftBarColor != (color.RGBA{0, 0, 0, 255}) {
		t.Fatalf("expected left bar to be black pillarbox, got %v", leftBarColor)
	}
	// Right pillarbox bar (e.g. at x = 95) should be black
	rightBarColor := dstTall.RGBAAt(95, 50)
	if rightBarColor != (color.RGBA{0, 0, 0, 255}) {
		t.Fatalf("expected right bar to be black pillarbox, got %v", rightBarColor)
	}
	// Center (at x = 50) should be white
	centerTallColor := dstTall.RGBAAt(50, 50)
	if centerTallColor != (color.RGBA{255, 255, 255, 255}) {
		t.Fatalf("expected center to be white, got %v", centerTallColor)
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

func TestDeviceLabelsFullResolutionCamera(t *testing.T) {
	// Create an alternating high-frequency black-and-white image (640x360)
	camImg := image.NewRGBA(image.Rect(0, 0, 640, 360))
	for y := 0; y < 360; y++ {
		for x := 0; x < 640; x++ {
			if x%2 == 0 {
				camImg.Set(x, y, color.White)
			} else {
				camImg.Set(x, y, color.Black)
			}
		}
	}
	var camBuf bytes.Buffer
	if err := jpeg.Encode(&camBuf, camImg, &jpeg.Options{Quality: 100}); err != nil {
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
			JPEGQuality: 100,
			MaxCameras:  12,
		},
		http: ts.Client(),
	}

	// Area with 2 cameras:
	// camera.full has the "Rocket Sheep | Full Resolution" label
	// camera.pixelated does not have the label
	area := AreaInfo{
		Name: "Test Area",
		Cameras: []State{
			{
				EntityID:     "camera.full",
				DeviceLabels: []string{"Rocket Sheep | Full Resolution"},
				Attributes:   map[string]any{"friendly_name": "Full Res Camera"},
			},
			{
				EntityID:   "camera.pixelated",
				Attributes: map[string]any{"friendly_name": "Pixelated Camera"},
			},
		},
	}

	jpgBytes, _, _, err := bot.render(context.Background(), area)
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}

	decoded, err := jpeg.Decode(bytes.NewReader(jpgBytes))
	if err != nil {
		t.Fatalf("failed to decode rendered jpeg: %v", err)
	}

	// For 2 cameras: cols=2, rows=1.
	// Camera 1 is at x in [gap .. gap+tw], Camera 2 is at x in [gap+tw+gap .. gap+2*tw+gap]
	// With JPEGQuality=100:
	// For camera.full (full resolution): adjacent pixels in the alternating pattern (e.g. x=gap+20 and x=gap+21)
	// will have significantly different luminosities (near 255 and near 0).
	// For camera.pixelated: adjacent pixels within the coarse pixel block (48 pixels wide on 640 width = ~13 px block)
	// will be averaged to near-identical gray values.

	gap := 4
	yCheck := gap + 100
	cFull0 := decoded.At(gap+20, yCheck)
	cFull1 := decoded.At(gap+21, yCheck)
	r0, _, _, _ := cFull0.RGBA()
	r1, _, _, _ := cFull1.RGBA()
	diffFull := math.Abs(float64(r0>>8) - float64(r1>>8))
	if diffFull < 100 {
		t.Fatalf("expected high difference between adjacent pixels in full resolution camera, got diff=%f (%v vs %v)", diffFull, cFull0, cFull1)
	}

	cPix0 := decoded.At(gap+640+gap+20, yCheck)
	cPix1 := decoded.At(gap+640+gap+21, yCheck)
	rPix0, _, _, _ := cPix0.RGBA()
	rPix1, _, _, _ := cPix1.RGBA()
	diffPix := math.Abs(float64(rPix0>>8) - float64(rPix1>>8))
	if diffPix > 30 {
		t.Fatalf("expected adjacent pixels in pixelated camera to be very similar (averaged), got diff=%f (%v vs %v)", diffPix, cPix0, cPix1)
	}
}

func TestDeviceLabelsIgnoreTemperatureSensor(t *testing.T) {
	// Case 1: First temp sensor has "Rocket Sheep | Ignore Temperature", second temp sensor is normal.
	sensors := []State{
		{
			EntityID:     "sensor.ignored_temp",
			State:        "18.5",
			DeviceLabels: []string{"Rocket Sheep | Ignore Temperature"},
			Attributes:   map[string]any{"device_class": "temperature", "unit_of_measurement": "°C"},
		},
		{
			EntityID:   "sensor.valid_temp",
			State:      "22.3",
			Attributes: map[string]any{"device_class": "temperature", "unit_of_measurement": "°C"},
		},
		{
			EntityID:     "sensor.device_humidity",
			State:        "45",
			DeviceLabels: []string{"Rocket Sheep | Ignore Temperature"},
			Attributes:   map[string]any{"device_class": "humidity", "unit_of_measurement": "%"},
		},
	}

	gotTemp := findSensor(sensors, "temp")
	if gotTemp != "TEMP 22.3°C" {
		t.Fatalf("expected 'TEMP 22.3°C', got %q", gotTemp)
	}

	gotHum := findSensor(sensors, "humidity")
	if gotHum != "HUMIDITY 45%" {
		t.Fatalf("expected humidity to not be ignored, got %q", gotHum)
	}

	// Case 2: Only one temp sensor and it is ignored.
	onlyIgnored := []State{
		{
			EntityID:     "sensor.ignored_temp",
			State:        "18.5",
			DeviceLabels: []string{"Rocket Sheep | Ignore Temperature"},
			Attributes:   map[string]any{"device_class": "temperature", "unit_of_measurement": "°C"},
		},
	}
	gotNoTemp := findSensor(onlyIgnored, "temp")
	if gotNoTemp != "" {
		t.Fatalf("expected empty string when only temp sensor is ignored, got %q", gotNoTemp)
	}

	// Case 3: Attribute fallback (device_labels / labels in Attributes)
	attrIgnored := []State{
		{
			EntityID:   "sensor.ignored_attr_temp",
			State:      "19.0",
			Attributes: map[string]any{"device_class": "temperature", "unit_of_measurement": "°C", "device_labels": []string{"rocket sheep | ignore temperature"}},
		},
	}
	if got := findSensor(attrIgnored, "temp"); got != "" {
		t.Fatalf("expected case-insensitive device_labels in attributes to be ignored, got %q", got)
	}
}

func TestDiscoverWithDeviceLabelsTemplate(t *testing.T) {
	areasTemplateResp := `[
		{
			"name": "Living Room",
			"entities": [
				{"id": "camera.living_room", "labels": ["Rocket Sheep | Full Resolution"]},
				{"id": "sensor.living_room_temp", "labels": ["Rocket Sheep | Ignore Temperature"]},
				{"id": "sensor.living_room_temp2", "labels": []}
			]
		}
	]`

	statesResp := `[
		{"entity_id": "camera.living_room", "state": "idle", "attributes": {"friendly_name": "Living Room Cam"}},
		{"entity_id": "sensor.living_room_temp", "state": "20.5", "attributes": {"device_class": "temperature", "unit_of_measurement": "°C"}},
		{"entity_id": "sensor.living_room_temp2", "state": "21.5", "attributes": {"device_class": "temperature", "unit_of_measurement": "°C"}}
	]`

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/template":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(areasTemplateResp))
		case "/api/states":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(statesResp))
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	bot := &Bot{
		cfg: Config{
			HAURL:   ts.URL,
			HAToken: "mock_token",
		},
		http: ts.Client(),
	}

	areas, err := bot.discover(context.Background())
	if err != nil {
		t.Fatalf("discover failed: %v", err)
	}
	if len(areas) != 1 {
		t.Fatalf("expected 1 area, got %d", len(areas))
	}
	if len(areas[0].Cameras) != 1 {
		t.Fatalf("expected 1 camera, got %d", len(areas[0].Cameras))
	}
	cam := areas[0].Cameras[0]
	if !hasDeviceLabel(cam, "Rocket Sheep | Full Resolution") {
		t.Fatalf("expected camera to have 'Rocket Sheep | Full Resolution' label, got %v", cam.DeviceLabels)
	}

	tempStr := findSensor(areas[0].Sensors, "temp")
	if tempStr != "TEMP 21.5°C" {
		t.Fatalf("expected discover sensors to ignore first temp and choose second, got %q", tempStr)
	}
}

func TestAreaEntityUnmarshal(t *testing.T) {
	// String format
	jsonStr := `["camera.one", "sensor.one"]`
	var ents1 []AreaEntity
	if err := json.Unmarshal([]byte(jsonStr), &ents1); err != nil {
		t.Fatalf("failed to unmarshal string list: %v", err)
	}
	if len(ents1) != 2 || ents1[0].EntityID != "camera.one" || ents1[1].EntityID != "sensor.one" {
		t.Fatalf("unexpected unmarshal result for strings: %+v", ents1)
	}

	// Object format with labels
	jsonObj := `[{"id": "camera.two", "labels": ["Rocket Sheep | Full Resolution"]}, {"entity_id": "sensor.two", "device_labels": ["Rocket Sheep | Ignore Temperature"]}]`
	var ents2 []AreaEntity
	if err := json.Unmarshal([]byte(jsonObj), &ents2); err != nil {
		t.Fatalf("failed to unmarshal object list: %v", err)
	}
	if len(ents2) != 2 || ents2[0].EntityID != "camera.two" || len(ents2[0].DeviceLabels) != 1 || ents2[0].DeviceLabels[0] != "Rocket Sheep | Full Resolution" {
		t.Fatalf("unexpected unmarshal result for objects: %+v", ents2)
	}
	if ents2[1].EntityID != "sensor.two" || len(ents2[1].DeviceLabels) != 1 || ents2[1].DeviceLabels[0] != "Rocket Sheep | Ignore Temperature" {
		t.Fatalf("unexpected unmarshal result for second object: %+v", ents2[1])
	}
}
