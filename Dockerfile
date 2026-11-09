FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /camera-bot .
FROM alpine:3.21
RUN adduser -D -u 10001 bot && mkdir /data && chown bot:bot /data
COPY --from=build /camera-bot /usr/local/bin/camera-bot
USER bot
ENTRYPOINT ["/usr/local/bin/camera-bot", "/config/config.json"]
