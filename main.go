package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	MatrixURL    string   `json:"matrix_url"`
	MatrixToken  string   `json:"matrix_token"`
	MatrixUser   string   `json:"matrix_user"`
	HAURL        string   `json:"home_assistant_url"`
	HAToken      string   `json:"home_assistant_token"`
	AllowedRooms []string `json:"allowed_rooms"`
	StateFile    string   `json:"state_file"`
	PixelsWide   int      `json:"privacy_pixels_wide"`
	TileWidth    int      `json:"tile_width"`
	TileHeight   int      `json:"tile_height"`
	JPEGQuality  int      `json:"jpeg_quality"`
	MaxCameras   int      `json:"max_cameras_per_area"`
}

func loadConfig(path string) (Config, error) {
	c := Config{StateFile: "/data/since.txt", PixelsWide: 48, TileWidth: 640, TileHeight: 360, JPEGQuality: 65, MaxCameras: 12}
	b, e := os.ReadFile(path)
	if e != nil {
		return c, e
	}
	if e = json.Unmarshal(b, &c); e != nil {
		return c, e
	}
	if v := os.Getenv("MATRIX_TOKEN"); v != "" {
		c.MatrixToken = v
	}
	if v := os.Getenv("HA_TOKEN"); v != "" {
		c.HAToken = v
	}
	if c.MatrixURL == "" || c.MatrixToken == "" || c.MatrixUser == "" || c.HAURL == "" || c.HAToken == "" {
		return c, errors.New("matrix_url, matrix_user, matrix_token, home_assistant_url and home_assistant_token are required")
	}
	if len(c.AllowedRooms) == 0 {
		return c, errors.New("configure at least one allowed room")
	}
	if c.PixelsWide < 12 || c.PixelsWide > 128 || c.TileWidth < 160 || c.TileWidth > 1280 || c.TileHeight < 90 || c.TileHeight > 720 || c.JPEGQuality < 20 || c.JPEGQuality > 90 || c.MaxCameras < 1 || c.MaxCameras > 30 {
		return c, errors.New("invalid image settings")
	}
	return c, nil
}

type State struct {
	EntityID   string         `json:"entity_id"`
	State      string         `json:"state"`
	Attributes map[string]any `json:"attributes"`
}
type Area struct {
	Name     string   `json:"name"`
	Entities []string `json:"entities"`
}
type AreaInfo struct {
	Name    string
	Cameras []State
	Sensors []State
}
type Bot struct {
	cfg  Config
	http *http.Client
}

func (b *Bot) request(ctx context.Context, method, endpoint, token string, body []byte, contentType string) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, e := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, e := b.http.Do(req)
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	data, e := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if e != nil {
		return nil, e
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d from %s: %s", resp.StatusCode, req.URL.Path, string(data[:min(len(data), 300)]))
	}
	return data, nil
}
func (b *Bot) haGet(ctx context.Context, path string) ([]byte, error) {
	return b.request(ctx, "GET", strings.TrimRight(b.cfg.HAURL, "/")+path, b.cfg.HAToken, nil, "")
}
func (b *Bot) haTemplate(ctx context.Context, template string) ([]byte, error) {
	body, _ := json.Marshal(map[string]string{"template": template})
	return b.request(ctx, "POST", strings.TrimRight(b.cfg.HAURL, "/")+"/api/template", b.cfg.HAToken, body, "application/json")
}

// The template returns the complete Home Assistant area-to-entity mapping, including
// entities whose area comes from their parent device. No entity-registry admin rights needed.
const areaTemplate = `{% set ns = namespace(rows=[]) %}{% for id in areas() %}{% set ns.rows = ns.rows + [dict(name=area_name(id), entities=area_entities(id))] %}{% endfor %}{{ ns.rows | to_json }}`

func (b *Bot) discover(ctx context.Context) ([]AreaInfo, error) {
	areasJSON, e := b.haTemplate(ctx, areaTemplate)
	if e != nil {
		return nil, fmt.Errorf("area discovery: %w", e)
	}
	var areas []Area
	if e = json.Unmarshal(bytes.TrimSpace(areasJSON), &areas); e != nil {
		return nil, fmt.Errorf("area JSON: %w: %s", e, string(areasJSON[:min(200, len(areasJSON))]))
	}
	statesJSON, e := b.haGet(ctx, "/api/states")
	if e != nil {
		return nil, e
	}
	var states []State
	if e = json.Unmarshal(statesJSON, &states); e != nil {
		return nil, e
	}
	stateMap := make(map[string]State, len(states))
	for _, s := range states {
		stateMap[s.EntityID] = s
	}
	result := make([]AreaInfo, 0, len(areas))
	for _, a := range areas {
		info := AreaInfo{Name: a.Name}
		seen := make(map[string]bool)
		for _, id := range a.Entities {
			if seen[id] {
				continue
			}
			seen[id] = true
			s, ok := stateMap[id]
			if !ok {
				continue
			}
			if strings.HasPrefix(id, "camera.") && s.State != "unavailable" && s.State != "unknown" {
				info.Cameras = append(info.Cameras, s)
			}
			if strings.HasPrefix(id, "sensor.") && s.State != "unavailable" && s.State != "unknown" {
				info.Sensors = append(info.Sensors, s)
			}
		}
		if len(info.Cameras) > 0 {
			sort.Slice(info.Cameras, func(i, j int) bool { return info.Cameras[i].EntityID < info.Cameras[j].EntityID })
			result = append(result, info)
		}
	}
	sort.Slice(result, func(i, j int) bool { return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name) })
	return result, nil
}
func attr(s State, key string) string {
	v, ok := s.Attributes[key]
	if !ok {
		return ""
	}
	return fmt.Sprint(v)
}
func findSensor(sensors []State, kind string) string {
	for _, s := range sensors {
		class := strings.ToLower(attr(s, "device_class"))
		id := strings.ToLower(s.EntityID)
		unit := strings.ToLower(attr(s, "unit_of_measurement"))
		match := false
		switch kind {
		case "temp":
			match = class == "temperature" || (strings.Contains(id, "temperature") && (unit == "°c" || unit == "°f" || unit == "c" || unit == "f"))
		case "humidity":
			match = class == "humidity" || (strings.Contains(id, "humidity") && unit == "%")
		case "pm25":
			match = class == "pm25" || class == "pm2_5" || strings.Contains(id, "pm2_5") || strings.Contains(id, "pm25") || strings.Contains(id, "pm2.5")
		}
		if !match {
			continue
		}
		v, e := strconv.ParseFloat(s.State, 64)
		if e != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		switch kind {
		case "temp":
			if unit == "" {
				unit = "°C"
			}
			return fmt.Sprintf("TEMP %.1f%s", v, attrUnit(unit))
		case "humidity":
			return fmt.Sprintf("HUMIDITY %.0f%%", v)
		case "pm25":
			return fmt.Sprintf("PM2.5 %.1f ug/m3", v)
		}
	}
	return ""
}
func attrUnit(s string) string {
	if s == "°c" || s == "c" {
		return "°C"
	}
	if s == "°f" || s == "f" {
		return "°F"
	}
	return s
}
func sensorLines(a AreaInfo) []string {
	lines := []string{}
	for _, kind := range []string{"temp", "humidity", "pm25"} {
		if s := findSensor(a.Sensors, kind); s != "" {
			lines = append(lines, s)
		}
	}
	return lines
}
func friendlyName(s State) string {
	if n := attr(s, "friendly_name"); n != "" {
		return n
	}
	return s.EntityID
}
func (b *Bot) cameraJPEG(ctx context.Context, entityID string) (image.Image, error) {
	path := "/api/camera_proxy/" + url.PathEscape(entityID) + "?t=" + strconv.FormatInt(time.Now().UnixNano(), 10)
	data, e := b.haGet(ctx, path)
	if e != nil {
		return nil, e
	}
	img, _, e := image.Decode(bytes.NewReader(data))
	if e != nil {
		return nil, fmt.Errorf("camera %s: %w", entityID, e)
	}
	bounds := img.Bounds()
	if bounds.Dx() > 8192 || bounds.Dy() > 8192 || int64(bounds.Dx())*int64(bounds.Dy()) > 32000000 {
		return nil, fmt.Errorf("camera %s: oversized image", entityID)
	}
	return img, nil
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func (b *Bot) render(ctx context.Context, a AreaInfo) ([]byte, int, int, error) {
	cameras := a.Cameras
	if len(cameras) > b.cfg.MaxCameras {
		cameras = cameras[:b.cfg.MaxCameras]
	}
	n := len(cameras)
	cols := int(math.Ceil(math.Sqrt(float64(n))))
	rows := (n + cols - 1) / cols
	const header = 56
	const caption = 24
	const gap = 4
	tw, th := b.cfg.TileWidth, b.cfg.TileHeight
	w := cols*tw + (cols+1)*gap
	h := header + rows*(th+caption) + (rows+1)*gap
	canvas := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{color.RGBA{20, 22, 25, 255}}, image.Point{}, draw.Src)
	drawText(canvas, 12, 14, a.Name, color.White, 3)
	drawText(canvas, 12, 40, time.Now().Format("2006-01-02 15:04:05 MST"), color.RGBA{175, 185, 195, 255}, 1)
	succeeded := 0
	for i, s := range cameras {
		cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		src, e := b.cameraJPEG(cctx, s.EntityID)
		cancel()
		x := gap + (i%cols)*(tw+gap)
		y := header + gap + (i/cols)*(th+caption+gap)
		if e != nil {
			log.Printf("snapshot %s: %v", s.EntityID, e)
			drawText(canvas, x+10, y+10, "CAMERA UNAVAILABLE", color.White, 2)
		} else {
			// Pixelation (not just JPEG compression): cap underlying detail to a
			// very small sample grid before any enlargement or annotation.
			pixelateCover(canvas, image.Rect(x, y, x+tw, y+th), src, b.cfg.PixelsWide)
			succeeded++
		}
		draw.Draw(canvas, image.Rect(x, y+th, x+tw, y+th+caption), &image.Uniform{color.RGBA{0, 0, 0, 255}}, image.Point{}, draw.Src)
		drawText(canvas, x+8, y+th+7, truncate(friendlyName(s), tw/8-3), color.White, 1)
	}
	if succeeded == 0 {
		return nil, 0, 0, errors.New("no camera snapshots could be retrieved")
	}
	lines := sensorLines(a)
	if len(lines) > 0 {
		// Solid overlay at the top left, matching the example screenshot.
		width := 12
		for _, line := range lines {
			width = max(width, len(line))
		}
		width = min(w-20, width*8+20)
		boxH := 14 + len(lines)*16
		draw.Draw(canvas, image.Rect(8, header+8, 8+width, header+8+boxH), &image.Uniform{color.RGBA{0, 0, 0, 255}}, image.Point{}, draw.Src)
		for i, line := range lines {
			drawText(canvas, 16, header+18+i*16, line, color.White, 1)
		}
	}
	var out bytes.Buffer
	if e := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: b.cfg.JPEGQuality}); e != nil {
		return nil, 0, 0, e
	}
	return out.Bytes(), w, h, nil
}
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 3 {
		return string(r[:max(0, n)])
	}
	return string(r[:n-3]) + "..."
}

// Nearest-neighbour pixelation with crop-to-fill. There is no full-resolution
// image included in the resulting JPEG. The sampled low-resolution image is the
// only data used to construct the picture.
func pixelateCover(dst *image.RGBA, rect image.Rectangle, src image.Image, pixelsWide int) {
	sb := src.Bounds()
	sw, sh := sb.Dx(), sb.Dy()
	if sw == 0 || sh == 0 {
		return
	}
	dw, dh := rect.Dx(), rect.Dy()
	cropW, cropH := float64(sw), float64(sh)
	if float64(sw)/float64(sh) > float64(dw)/float64(dh) {
		cropW = float64(sh) * float64(dw) / float64(dh)
	} else {
		cropH = float64(sw) * float64(dh) / float64(dw)
	}
	offsetX := (float64(sw) - cropW) / 2
	offsetY := (float64(sh) - cropH) / 2
	pw := min(pixelsWide, dw)
	ph := max(1, int(math.Round(float64(pw)*float64(dh)/float64(dw))))
	// Each coarse pixel averages its source footprint, preventing aliasing and
	// better removing small detail than taking a single sample.
	samples := make([]color.RGBA, pw*ph)
	for py := 0; py < ph; py++ {
		for px := 0; px < pw; px++ {
			x0 := int(offsetX + float64(px)*cropW/float64(pw))
			x1 := int(offsetX + float64(px+1)*cropW/float64(pw))
			y0 := int(offsetY + float64(py)*cropH/float64(ph))
			y1 := int(offsetY + float64(py+1)*cropH/float64(ph))
			x1 = max(x0+1, x1)
			y1 = max(y0+1, y1)
			// Limit the number of pixel reads per region for high-resolution cameras.
			stepx := max(1, (x1-x0)/12)
			stepy := max(1, (y1-y0)/12)
			var rr, gg, bb, nn uint64
			for yy := y0; yy < y1; yy += stepy {
				for xx := x0; xx < x1; xx += stepx {
					r, g, b, _ := src.At(sb.Min.X+min(xx, sw-1), sb.Min.Y+min(yy, sh-1)).RGBA()
					rr += uint64(r >> 8)
					gg += uint64(g >> 8)
					bb += uint64(b >> 8)
					nn++
				}
			}
			samples[py*pw+px] = color.RGBA{uint8(rr / nn), uint8(gg / nn), uint8(bb / nn), 255}
		}
	}
	for yy := 0; yy < dh; yy++ {
		sy := min(ph-1, yy*ph/dh)
		for xx := 0; xx < dw; xx++ {
			sx := min(pw-1, xx*pw/dw)
			dst.SetRGBA(rect.Min.X+xx, rect.Min.Y+yy, samples[sy*pw+sx])
		}
	}
}

// Tiny built-in 5x7 font avoids native image libraries, font files, or CGO.
var glyphs = map[rune][]string{
	'A': {"01110", "10001", "10001", "11111", "10001", "10001", "10001"}, 'B': {"11110", "10001", "10001", "11110", "10001", "10001", "11110"}, 'C': {"01111", "10000", "10000", "10000", "10000", "10000", "01111"}, 'D': {"11110", "10001", "10001", "10001", "10001", "10001", "11110"}, 'E': {"11111", "10000", "10000", "11110", "10000", "10000", "11111"}, 'F': {"11111", "10000", "10000", "11110", "10000", "10000", "10000"}, 'G': {"01111", "10000", "10000", "10111", "10001", "10001", "01110"}, 'H': {"10001", "10001", "10001", "11111", "10001", "10001", "10001"}, 'I': {"11111", "00100", "00100", "00100", "00100", "00100", "11111"}, 'J': {"00111", "00010", "00010", "00010", "10010", "10010", "01100"}, 'K': {"10001", "10010", "10100", "11000", "10100", "10010", "10001"}, 'L': {"10000", "10000", "10000", "10000", "10000", "10000", "11111"}, 'M': {"10001", "11011", "10101", "10101", "10001", "10001", "10001"}, 'N': {"10001", "11001", "10101", "10011", "10001", "10001", "10001"}, 'O': {"01110", "10001", "10001", "10001", "10001", "10001", "01110"}, 'P': {"11110", "10001", "10001", "11110", "10000", "10000", "10000"}, 'Q': {"01110", "10001", "10001", "10001", "10101", "10010", "01101"}, 'R': {"11110", "10001", "10001", "11110", "10100", "10010", "10001"}, 'S': {"01111", "10000", "10000", "01110", "00001", "00001", "11110"}, 'T': {"11111", "00100", "00100", "00100", "00100", "00100", "00100"}, 'U': {"10001", "10001", "10001", "10001", "10001", "10001", "01110"}, 'V': {"10001", "10001", "10001", "10001", "10001", "01010", "00100"}, 'W': {"10001", "10001", "10001", "10101", "10101", "10101", "01010"}, 'X': {"10001", "10001", "01010", "00100", "01010", "10001", "10001"}, 'Y': {"10001", "10001", "01010", "00100", "00100", "00100", "00100"}, 'Z': {"11111", "00001", "00010", "00100", "01000", "10000", "11111"},
	'0': {"01110", "10001", "10011", "10101", "11001", "10001", "01110"}, '1': {"00100", "01100", "00100", "00100", "00100", "00100", "01110"}, '2': {"01110", "10001", "00001", "00010", "00100", "01000", "11111"}, '3': {"11110", "00001", "00001", "01110", "00001", "00001", "11110"}, '4': {"00010", "00110", "01010", "10010", "11111", "00010", "00010"}, '5': {"11111", "10000", "10000", "11110", "00001", "00001", "11110"}, '6': {"01110", "10000", "10000", "11110", "10001", "10001", "01110"}, '7': {"11111", "00001", "00010", "00100", "01000", "01000", "01000"}, '8': {"01110", "10001", "10001", "01110", "10001", "10001", "01110"}, '9': {"01110", "10001", "10001", "01111", "00001", "00001", "01110"},
	'.': {"00000", "00000", "00000", "00000", "00000", "01100", "01100"}, ':': {"00000", "01100", "01100", "00000", "01100", "01100", "00000"}, '-': {"00000", "00000", "00000", "11111", "00000", "00000", "00000"}, '_': {"00000", "00000", "00000", "00000", "00000", "00000", "11111"}, '/': {"00001", "00001", "00010", "00100", "01000", "10000", "10000"}, '%': {"11001", "11010", "00100", "00100", "01011", "10011", "00000"}, ' ': {"00000", "00000", "00000", "00000", "00000", "00000", "00000"}, '?': {"01110", "10001", "00001", "00010", "00100", "00000", "00100"}, '°': {"01100", "10010", "01100", "00000", "00000", "00000", "00000"}, '+': {"00000", "00100", "00100", "11111", "00100", "00100", "00000"}, '(': {"00010", "00100", "01000", "01000", "01000", "00100", "00010"}, ')': {"01000", "00100", "00010", "00010", "00010", "00100", "01000"},
}

func drawText(dst *image.RGBA, x, y int, s string, col color.Color, scale int) {
	c := color.RGBAModel.Convert(col).(color.RGBA)
	for _, r := range strings.ToUpper(s) {
		g, ok := glyphs[r]
		if !ok {
			g = glyphs['?']
		}
		for yy, row := range g {
			for xx, ch := range row {
				if ch != '1' {
					continue
				}
				for sy := 0; sy < scale; sy++ {
					for sx := 0; sx < scale; sx++ {
						px := x + xx*scale + sx
						py := y + yy*scale + sy
						if image.Pt(px, py).In(dst.Bounds()) {
							dst.SetRGBA(px, py, c)
						}
					}
				}
			}
		}
		x += 6 * scale
	}
}
func (b *Bot) mx(ctx context.Context, method, path string, body []byte, typ string) ([]byte, error) {
	return b.request(ctx, method, strings.TrimRight(b.cfg.MatrixURL, "/")+path, b.cfg.MatrixToken, body, typ)
}
func (b *Bot) send(ctx context.Context, room string, content any) error {
	data, _ := json.Marshal(content)
	txn := strconv.FormatInt(time.Now().UnixNano(), 10)
	_, e := b.mx(ctx, "PUT", "/_matrix/client/v3/rooms/"+url.PathEscape(room)+"/send/m.room.message/"+txn, data, "application/json")
	return e
}
func (b *Bot) text(ctx context.Context, room, msg string) error {
	return b.send(ctx, room, map[string]any{"msgtype": "m.text", "body": msg})
}
func (b *Bot) image(ctx context.Context, room, name string, jpg []byte, w, h int) error {
	data, e := b.mx(ctx, "POST", "/_matrix/media/v3/upload?filename="+url.QueryEscape("camera.jpg"), jpg, "image/jpeg")
	if e != nil {
		return e
	}
	var uploaded struct {
		ContentURI string `json:"content_uri"`
	}
	if e = json.Unmarshal(data, &uploaded); e != nil {
		return e
	}
	if uploaded.ContentURI == "" {
		return errors.New("Matrix upload has no content_uri")
	}
	return b.send(ctx, room, map[string]any{"msgtype": "m.image", "body": name + " (privacy-reduced snapshot)", "url": uploaded.ContentURI, "info": map[string]any{"mimetype": "image/jpeg", "size": len(jpg), "w": w, "h": h}})
}
func contains(items []string, s string) bool {
	for _, v := range items {
		if v == s {
			return true
		}
	}
	return false
}
func (b *Bot) handle(ctx context.Context, room, sender, body string) {
	if !contains(b.cfg.AllowedRooms, room) {
		return
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(body)), "!camera") {
		return
	}
	parts := strings.Fields(body)
	if len(parts) < 2 {
		return
	}
	areas, e := b.discover(ctx)
	if e != nil {
		log.Printf("discovery: %v", e)
		_ = b.text(ctx, room, "Camera lookup failed; check bot logs.")
		return
	}
	switch strings.ToLower(parts[1]) {
	case "list":
		if len(parts) != 2 {
			_ = b.text(ctx, room, "Usage: !camera list")
			return
		}
		if len(areas) == 0 {
			_ = b.text(ctx, room, "No areas with available cameras found.")
			return
		}
		var lines []string
		for _, a := range areas {
			lines = append(lines, fmt.Sprintf("%s (%d camera(s))", a.Name, len(a.Cameras)))
		}
		_ = b.text(ctx, room, "Camera areas:\n"+strings.Join(lines, "\n"))
	case "show":
		if len(parts) < 3 {
			_ = b.text(ctx, room, "Usage: !camera show <area name>")
			return
		}
		name := strings.Join(parts[2:], " ")
		var target *AreaInfo
		for i := range areas {
			if strings.EqualFold(areas[i].Name, name) {
				target = &areas[i]
				break
			}
		}
		if target == nil {
			_ = b.text(ctx, room, "Area not found, or it has no cameras. Use !camera list.")
			return
		}
		jpg, w, h, e := b.render(ctx, *target)
		if e != nil {
			log.Printf("render: %v", e)
			_ = b.text(ctx, room, "Could not retrieve any snapshots for that area.")
			return
		}
		if e = b.image(ctx, room, target.Name, jpg, w, h); e != nil {
			log.Printf("Matrix image: %v", e)
			_ = b.text(ctx, room, "Image upload failed; check bot logs.")
		}
	default:
		_ = b.text(ctx, room, "Usage: !camera list  |  !camera show <area name>")
	}
}

type MatrixEvent struct {
	Type     string `json:"type"`
	Sender   string `json:"sender"`
	EventID  string `json:"event_id"`
	OriginTS int64  `json:"origin_server_ts"`
	Content  struct {
		MsgType string `json:"msgtype"`
		Body    string `json:"body"`
	} `json:"content"`
}
type SyncReply struct {
	NextBatch string `json:"next_batch"`
	Rooms     struct {
		Join map[string]struct {
			Timeline struct {
				Events []MatrixEvent `json:"events"`
			} `json:"timeline"`
		} `json:"join"`
	} `json:"rooms"`
}

func (b *Bot) sync(ctx context.Context, since string) (SyncReply, error) {
	var resp SyncReply
	params := url.Values{}
	params.Set("timeout", "25000")
	if since != "" {
		params.Set("since", since)
	}
	// Request only newly arriving timeline events; no room state or presence needed.
	params.Set("filter", `{"room":{"timeline":{"limit":20,"types":["m.room.message"]},"state":{"types":[]},"ephemeral":{"types":[]},"account_data":{"types":[]}},"presence":{"types":[]},"account_data":{"types":[]}}`)
	data, e := b.mx(ctx, "GET", "/_matrix/client/v3/sync?"+params.Encode(), nil, "")
	if e != nil {
		return resp, e
	}
	e = json.Unmarshal(data, &resp)
	return resp, e
}
func (b *Bot) run(ctx context.Context) error {
	sinceData, _ := os.ReadFile(b.cfg.StateFile)
	since := strings.TrimSpace(string(sinceData))
	// On first startup, establish a fresh cursor rather than replying to history.
	if since == "" {
		log.Print("First startup: establishing fresh Matrix sync cursor")
		r, e := b.sync(ctx, "")
		if e != nil {
			return e
		}
		since = r.NextBatch
		saveSince(b.cfg.StateFile, since)
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		r, e := b.sync(ctx, since)
		if e != nil {
			log.Printf("Matrix sync: %v", e)
			time.Sleep(5 * time.Second)
			continue
		}
		// Advance before acting: on restart, an earlier command cannot be replayed.
		// Commands that arrive while a prior one is being processed are retained by
		// the next sync because this batch is completely processed first.
		if r.NextBatch != "" {
			since = r.NextBatch
			saveSince(b.cfg.StateFile, since)
		}
		for room, events := range r.Rooms.Join {
			for _, ev := range events.Timeline.Events {
				if ev.Type != "m.room.message" || ev.Sender == b.cfg.MatrixUser || ev.Content.MsgType != "m.text" {
					continue
				}
				cmdCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
				b.handle(cmdCtx, room, ev.Sender, ev.Content.Body)
				cancel()
			}
		}
	}
}
func saveSince(path, since string) {
	dir := filepath.Dir(path)
	if e := os.MkdirAll(dir, 0700); e != nil {
		log.Printf("save sync dir: %v", e)
		return
	}
	if e := os.WriteFile(path+".tmp", []byte(since), 0600); e != nil {
		log.Printf("save sync: %v", e)
		return
	}
	if e := os.Rename(path+".tmp", path); e != nil {
		log.Printf("rename sync state: %v", e)
	}
}
func main() {
	path := "config.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	cfg, e := loadConfig(path)
	if e != nil {
		log.Fatal(e)
	}
	log.Printf("Starting camera bot %s", cfg.MatrixUser)
	bot := Bot{cfg: cfg, http: &http.Client{Timeout: 40 * time.Second}}
	if e = bot.run(context.Background()); e != nil {
		log.Fatal(e)
	}
}
