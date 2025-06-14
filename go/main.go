package main

import (
	"context"
	"flag"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"

	"github.com/golang/glog"
	"github.com/google/uuid"
	"github.com/gordonklaus/portaudio"
	"github.com/gorilla/websocket"
)

var (
	appid       = "9168491271"
	accessToken = "YOUR_API_KEY_HERE"

	wsURL    = url.URL{Scheme: "wss", Host: "openspeech.bytedance.com", Path: "/api/v3/realtime/dialogue"}
	protocol = NewBinaryProtocol()
)

func init() {
	protocol.SetVersion(Version1)
	protocol.SetHeaderSize(HeaderSize4)
	protocol.SetSerialization(SerializationJSON)
	protocol.SetCompression(CompressionNone, nil)
	protocol.containsSequence = ContainsSequence
}

// 流式合成
func realTimeDialog(ctx context.Context, c *websocket.Conn, sessionID string) {
	err := startConnection(c)
	if err != nil {
		glog.Errorf("realTimeDialog startConnection error: %v", err)
		return
	}
	extra := map[string]interface{}{
		"strict_audit": false,
	}
	err = startSession(c, sessionID, &StartSessionPayload{
		TTS: TTSPayload{
			AudioConfig: AudioConfig{
				Channel:    1,
				Format:     "pcm",
				SampleRate: 24000,
			},
		},
		Dialog: DialogPayload{
			BotName: "豆包",
			Extra:   extra,
		},
	})
	if err != nil {
		glog.Errorf("realTimeDialog startSession error: %v", err)
		return
	}
	// 模拟发送音频流到服务端
	sendAudio(ctx, c, sessionID)

	// 接收服务端返回数据
	realtimeAPIOutputAudio(ctx, c)

	// 结束对话，断开websocket连接
	err = finishConnection(c)
	if err != nil {
		glog.Errorf("Failed to finish connection: %v", err)
	}
	glog.Info("realTimeDialog finished.")
}

func main() {
	_ = flag.Set("logtostderr", "true")
	flag.Parse()

	if err := portaudio.Initialize(); err != nil {
		glog.Fatalf("portaudio initialize error: %v", err)
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer func() {
		err := portaudio.Terminate()
		if err != nil {
			glog.Errorf("Failed to terminate portaudio: %v", err)
		}
		stop()
	}()

	conn, resp, err := websocket.DefaultDialer.DialContext(ctx, wsURL.String(), http.Header{
		"X-Api-Resource-Id": []string{"volc.speech.dialog"},
		"X-Api-Access-Key":  []string{accessToken},
		"X-Api-App-Key":     []string{"PlgvMymc7f3tQnJ6"},
		"X-Api-App-ID":      []string{appid},
		"X-Api-Connect-Id":  []string{uuid.New().String()},
	})
	if err != nil {
		glog.Errorf("Websocket dial error: %v", err)
		return
	}
	defer func() {
		if resp != nil {
			glog.Infof("Websocket dial response logid: %s", resp.Header.Get("X-Tt-Logid"))
		}
		_ = conn.Close()
	}()

	realTimeDialog(ctx, conn, uuid.New().String())
}
