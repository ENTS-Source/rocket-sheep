package main

import (
	"image"
	"image/color"
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
