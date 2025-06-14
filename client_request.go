package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/golang/glog"
	"github.com/gordonklaus/portaudio"
	"github.com/gorilla/websocket"
)

type StartSessionPayload struct {
	TTS    TTSPayload    `json:"tts"`
	Dialog DialogPayload `json:"dialog"`
}

type SayHelloPayload struct {
	Content string `json:"content"`
}

type ChatTTSTextPayload struct {
	Start   bool   `json:"start"`
	End     bool   `json:"end"`
	Content string `json:"content"`
}

type TTSPayload struct {
	AudioConfig AudioConfig `json:"audio_config"`
}

type AudioConfig struct {
	Channel    int    `json:"channel"`
	Format     string `json:"format"`
	SampleRate int    `json:"sample_rate"`
}

type DialogPayload struct {
	BotName  string                 `json:"bot_name"`
	DialogID string                 `json:"dialog_id"`
	Extra    map[string]interface{} `json:"extra"`
}

func startConnection(conn *websocket.Conn) error {
	msg, err := NewMessage(MsgTypeFullClient, MsgTypeFlagWithEvent)
	if err != nil {
		return fmt.Errorf("create StartSession request message: %w", err)
	}
	msg.Event = 1
	msg.Payload = []byte("{}")

	frame, err := protocol.Marshal(msg)
	glog.Infof("StartConnection frame: %v", frame)
	if err != nil {
		return fmt.Errorf("marshal StartConnection request message: %w", err)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("send StartConnection request: %w", err)
	}

	// Read ConnectionStarted message.
	mt, frame, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("read ConnectionStarted response: %w", err)
	}
	if mt != websocket.BinaryMessage && mt != websocket.TextMessage {
		return fmt.Errorf("unexpected Websocket message type: %d", mt)
	}

	msg, _, err = Unmarshal(frame, protocol.containsSequence)
	if err != nil {
		glog.Infof("StartConnection response: %s", frame)
		return fmt.Errorf("unmarshal ConnectionStarted response message: %w", err)
	}
	if msg.Type != MsgTypeFullServer {
		return fmt.Errorf("unexpected ConnectionStarted message type: %s", msg.Type)
	}
	if msg.Event != 50 {
		return fmt.Errorf("unexpected response event (%d) for StartConnection request", msg.Event)
	}
	glog.Infof("Connection started (event=%d) connectID: %s, payload: %s", msg.Event, msg.ConnectID, msg.Payload)

	return nil
}

func startSession(conn *websocket.Conn, sessionID string, req *StartSessionPayload) error {
	payload, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal StartSession request payload: %w", err)
	}

	msg, err := NewMessage(MsgTypeFullClient, MsgTypeFlagWithEvent)
	if err != nil {
		return fmt.Errorf("create StartSession request message: %w", err)
	}
	msg.Event = 100
	msg.SessionID = sessionID
	msg.Payload = payload

	frame, err := protocol.Marshal(msg)
	glog.Infof("StartSession request frame: %v", frame)
	if err != nil {
		return fmt.Errorf("marshal StartSession request message: %w", err)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("send StartSession request: %w", err)
	}

	// Read SessionStarted message.
	mt, frame, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("read SessionStarted response: %w", err)
	}
	if mt != websocket.BinaryMessage && mt != websocket.TextMessage {
		return fmt.Errorf("unexpected Websocket message type: %d", mt)
	}

	// Validate SessionStarted message.
	msg, _, err = Unmarshal(frame, protocol.containsSequence)
	if err != nil {
		glog.Infof("StartSession response: %s", frame)
		return fmt.Errorf("unmarshal SessionStarted response message: %w", err)
	}
	if msg.Type != MsgTypeFullServer {
		return fmt.Errorf("unexpected SessionStarted message type: %s", msg.Type)
	}
	if msg.Event != 150 {
		return fmt.Errorf("unexpected response event (%d) for StartSession request", msg.Event)
	}
	glog.Infof("SessionStarted response payload: %v", string(msg.Payload))

	return nil
}

func sayHello(conn *websocket.Conn, sessionID string, req *SayHelloPayload) error {
	payload, err := json.Marshal(req)
	glog.Infof("SayHello request payload: %s", string(payload))
	if err != nil {
		return fmt.Errorf("marshal SayHello request payload: %w", err)
	}

	msg, err := NewMessage(MsgTypeFullClient, MsgTypeFlagWithEvent)
	if err != nil {
		return fmt.Errorf("create SayHello request message: %w", err)
	}
	msg.Event = 300
	msg.SessionID = sessionID
	msg.Payload = payload

	frame, err := protocol.Marshal(msg)
	glog.Infof("SayHello frame: %v", frame)
	if err != nil {
		return fmt.Errorf("marshal SayHello request message: %w", err)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("send SayHello request: %w", err)
	}
	return nil
}

func chatTTSText(conn *websocket.Conn, sessionID string, req *ChatTTSTextPayload) error {
	payload, err := json.Marshal(req)
	glog.Infof("ChatTTSText request payload: %s", string(payload))
	if err != nil {
		return fmt.Errorf("marshal ChatTTSText request payload: %w", err)
	}

	msg, err := NewMessage(MsgTypeFullClient, MsgTypeFlagWithEvent)
	if err != nil {
		return fmt.Errorf("create ChatTTSText request message: %w", err)
	}
	msg.Event = 500
	msg.SessionID = sessionID
	msg.Payload = payload

	frame, err := protocol.Marshal(msg)
	glog.Infof("ChatTTSText frame: %v", frame)
	if err != nil {
		return fmt.Errorf("marshal ChatTTSText request message: %w", err)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("send ChatTTSText request: %w", err)
	}
	return nil
}

func sendAudio(ctx context.Context, c *websocket.Conn, sessionID string) {
	go func() {
		defer func() {
			if err := recover(); err != nil {
				glog.Errorf("panic: %v", err)
			}
		}()
		defaultInputDevice, err := portaudio.DefaultInputDevice()
		if err != nil {
			glog.Errorf("Failed to get default input device: %v", err)
			return
		}
		glog.Infof("Using default input device: %s", defaultInputDevice.Name)
		streamParameters := portaudio.StreamParameters{
			Input: portaudio.StreamDeviceParameters{
				Device:   defaultInputDevice,
				Channels: 1,
				Latency:  defaultInputDevice.DefaultLowInputLatency,
			},
			SampleRate:      16000,
			FramesPerBuffer: 160,
		}

		stream, err := portaudio.OpenStream(streamParameters, func(in []int16) {
			//glog.Infof("Sending audio: %v", in)
			// 1. 将 int16 音频数据转换为 []byte (PCM S16LE)
			audioBytes := make([]byte, len(in)*2)
			for i, sample := range in {
				audioBytes[i*2] = byte(sample & 0xff)
				audioBytes[i*2+1] = byte((sample >> 8) & 0xff)
			}

			// 2. 设置序列化方式为原始数据
			// 你提供的 sendAudioData 示例中在此处设置。确保这对你的协议是正确的。
			protocol.SetSerialization(SerializationRaw)

			// 3. 创建并发送消息
			msg, err := NewMessage(MsgTypeAudioOnlyClient, MsgTypeFlagWithEvent)
			if err != nil {
				glog.Errorf("Error creating audio message: %v", err)
				return // 从回调中退出
			}

			msg.Event = 200
			msg.SessionID = sessionID
			msg.Payload = audioBytes

			frame, err := protocol.Marshal(msg)
			if err != nil {
				glog.Errorf("Error marshalling audio message: %v", err)
				return // 从回调中退出
			}

			//glog.Infof("Sent %d bytes of audio data for frame %v", len(audioBytes), frame)
			if err := c.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				glog.Errorf("Error sending audio message: %v", err)
				// 持续发送失败可能需要停止音频流，目前仅记录日志。
				return
			}
		})
		if err != nil {
			glog.Errorf("Failed to open microphone input stream: %v", err)
			return
		}
		defer stream.Close()

		if err := stream.Start(); err != nil {
			glog.Errorf("Failed to start microphone input stream: %v", err)
			return
		}
		glog.Info("Microphone input stream started. please speak...")

		// 保持 goroutine 运行以允许回调处理音频
		select {
		case <-ctx.Done():
			glog.Info("Stopping microphone input stream due to context cancellation...")
			if err := stream.Stop(); err != nil {
				glog.Errorf("Failed to stop microphone input stream: %v", err)
			}
			err = finishSession(c, sessionID)
			if err != nil {
				glog.Errorf("Failed to finish session: %v", err)
			}
		}
		glog.Info("Microphone input stream stopped.")
	}()
}

func finishSession(conn *websocket.Conn, sessionID string) error {
	msg, err := NewMessage(MsgTypeFullClient, MsgTypeFlagWithEvent)
	if err != nil {
		return fmt.Errorf("create FinishSession request message: %w", err)
	}
	msg.Event = 102
	msg.SessionID = sessionID
	msg.Payload = []byte("{}")

	frame, err := protocol.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal FinishSession request message: %w", err)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("send FinishSession request: %w", err)
	}

	glog.Info("FinishSession request is sent.")
	return nil
}

func finishConnection(conn *websocket.Conn) error {
	msg, err := NewMessage(MsgTypeFullClient, MsgTypeFlagWithEvent)
	if err != nil {
		return fmt.Errorf("create FinishConnection request message: %w", err)
	}
	msg.Event = 2
	msg.Payload = []byte("{}")

	frame, err := protocol.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal FinishConnection request message: %w", err)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
		return fmt.Errorf("send FinishConnection request: %w", err)
	}

	// Read ConnectionStarted message.
	mt, frame, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("read ConnectionFinished response: %w", err)
	}
	if mt != websocket.BinaryMessage && mt != websocket.TextMessage {
		return fmt.Errorf("unexpected Websocket message type: %d", mt)
	}

	msg, _, err = Unmarshal(frame, protocol.containsSequence)
	if err != nil {
		glog.Infof("FinishConnection response: %s", frame)
		return fmt.Errorf("unmarshal ConnectionFinished response message: %w", err)
	}
	if msg.Type != MsgTypeFullServer {
		return fmt.Errorf("unexpected ConnectionFinished message type: %s", msg.Type)
	}
	if msg.Event != 52 {
		return fmt.Errorf("unexpected response event (%d) for FinishConnection request", msg.Event)
	}

	glog.Infof("Connection finished (event=%d).", msg.Event)
	return nil
}
