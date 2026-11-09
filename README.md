# Rocket Sheep

A minimal Go Matrix bot that renders privacy-reduced still images from Home Assistant cameras (including Frigate camera entities). Uses the standard library exclusively; no CGO, fonts, image processing binaries, or external Go packages.

## Commands

- `!camera list` — list areas with at least one available camera, sorted by area name.
- `!camera show Pottery` — one tiled still image of every camera in the `Pottery` area, with any temperature, humidity and PM2.5 sensors in that area.

Area names are case-insensitive, and may contain spaces (`!camera show Pottery Studio`). There is no separate camera mapping. Camera entities assigned directly to an area or inherited via their device are included.

## Setup

1. Create a dedicated Matrix bot account and join it to the room(s) where commands should work. Obtain an access token for that account. **Do not use your own Matrix account token.**
2. In Home Assistant, create a dedicated user with permission to read the required camera and sensor entities. Generate a long-lived access token under its profile. The token also must be authorized to use `/api/template` (Home Assistant documents this endpoint as admin-only); depending on your HA setup, that may require an administrator account. Protect this token.
3. Assign camera entities (or their associated devices) to Home Assistant areas. Assign temperature/humidity/PM2.5 sensors to the same areas.
4. Run:

   ```sh
   cp config.example.json config.json
   cp .env.example .env
   ```

5. Edit `config.json` and set `matrix_url`, `matrix_user`, `home_assistant_url`, plus the exact Matrix room IDs and sender user IDs to allow. Set tokens in `.env` (recommended; do not commit secrets).
6. Start:

   ```sh
   docker compose up -d --build
   docker compose logs -f camera-bot
   ```

Alternatively, use `go run . config.json` with the `MATRIX_TOKEN` and `HA_TOKEN` environment variables set. Go 1.23 or newer is required.

### Example interaction

```text
User: !camera list
Bot:  Camera areas:
      Electronics (1 camera(s))
      Pottery (2 camera(s))
      Woodshop (1 camera(s))

User: !camera show Pottery
Bot:  [one JPEG containing the two Pottery cameras]
```

## Privacy

**Image pixelation is a visual privacy measure, not a guarantee of anonymity.** Default settings reduce each 640x360 camera tile to **48x27 sampled colour blocks**, then enlarge that grid with nearest-neighbour interpolation. This discards detail before the JPEG is uploaded to Matrix. A person may be identifiable by clothing, location, silhouette, or context despite the pixelation. The bot **does not** use face recognition or promise to remove readable text under every lighting/camera condition. Review a representative image from your environment before granting broader access.

Set `privacy_pixels_wide` smaller (e.g. **24** or **32**) for more aggressive privacy reduction; larger values preserve more occupancy detail but increase the risk of recognizing people or reading signs. `jpeg_quality` controls file size only and should **not** be treated as the privacy control.

The original snapshot stays in the bot process memory, and the bot sends only the processed JPEG to Matrix. Matrix servers and room members can retain/re-share uploaded JPEGs. **Use a private room and explicit sender/room allowlists; avoid putting raw camera snapshots in Matrix.** End-to-end encryption is *not* implemented in this bot: use an unencrypted, access-controlled Matrix room or add an encryption-capable Matrix client SDK before using encrypted rooms. If your use case requires encrypted transport/storage to Matrix members, do not use this example as-is.

## Rendering

- Tiles are auto-arranged in a roughly square grid, ordered by entity ID.
- Camera snapshots are fetched from Home Assistant `GET /api/camera_proxy/camera.entity_id` using the HA token; a current snapshot is requested on every command.
- If a camera fails to load, its tile shows `CAMERA UNAVAILABLE`; if all fail, no image is posted.
- Image overlay is in the upper-left of the tiled picture; measurements appear only when matching valid numeric sensors exist.
- Sensor detection uses Home Assistant `device_class` and entity ID conventions. The first matching sensor per measurement type is used, sorted by entity ID; sensors are not averaged.
- Caution: if an area has multiple temperature sensors, the selected sensor may not be the most representative one.

## Configuration

| Key | Description |
| --- | --- |
| `matrix_url` | Base homeserver URL. |
| `matrix_user` | Exact bot MXID; own messages are ignored. |
| `home_assistant_url` | Reachable Home Assistant base URL. |
| `allowed_rooms` | Exact Matrix room IDs permitted for commands (required). |
| `state_file` | Matrix sync cursor on persistent volume. |
| `privacy_pixels_wide` | Coarse sample columns **per tile** (12-128; recommended 24-48). |
| `tile_width`, `tile_height` | Output pixels for each camera tile; defaults 640x360. |
| `jpeg_quality` | JPEG quality; default 65. |
| `max_cameras_per_area` | Cap on camera tiles; default 12. |

Access tokens can be included as `matrix_token` and `home_assistant_token` config keys but the environment variables `MATRIX_TOKEN` and `HA_TOKEN` override them.

## Troubleshooting

- `Area not found` — check HA area assignments and `!camera list`. Camera entities must exist and not be in `unavailable` / `unknown` states.
- `Camera lookup failed` — check Home Assistant connectivity, token permissions and `/api/template` authorization; inspect `docker compose logs camera-bot`.
- `Could not retrieve any snapshots` — check the camera proxy endpoint with the same token. Your camera integration may have a stream but no working still-image proxy.
- No response — verify the bot joined the room, the room ID and sender MXID are in both allowlists, the room is unencrypted, and the bot is running.
- Missing environmental data — check sensor `device_class`, numeric state, and area assignment; `unavailable` and `unknown` are ignored.

## Operational notes

The bot uses Matrix `/sync` long polling, a durable `since` cursor and Matrix media uploads. On a clean first boot it skips historical messages. It does not backfill commands during downtime. Its image rendering and Home Assistant network calls are synchronous, so large numbers of requests are processed serially. Tokens should be rotated if exposed.
