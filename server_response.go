package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/golang/glog"
	"github.com/gordonklaus/portaudio"
	"github.com/gorilla/websocket"
)

const (
	sampleRate      = 24000
	channels        = 1
	framesPerBuffer = 512
	bufferSeconds   = 100 // 最多缓冲100秒数据
)

var (
	audio      []byte
	bufferLock sync.Mutex
	buffer     = make([]float32, 0, sampleRate*bufferSeconds)
)

func realtimeAPIOutputAudio(ctx context.Context, conn *websocket.Conn) {
	go startPlayer(ctx)
	for {
		glog.Infof("Waiting for message...")
		msg, err := receiveMessage(conn)
		if err != nil {
			glog.Errorf("Receive message error: %v", err)
			return
		}
		switch msg.Type {
		case MsgTypeFullServer:
			glog.Infof("Receive text message (event=%d, session_id=%s): %s", msg.Event, msg.SessionID, msg.Payload)
			// session finished event
			if msg.Event == 152 || msg.Event == 153 {
				return
			}
			// asr info event, clear audio buffer
			if msg.Event == 450 {
				audio = audio[:0]
				buffer = buffer[:0]
			}
		case MsgTypeAudioOnlyServer:
			glog.Infof("Receive audio message (event=%d): session_id=%s", msg.Event, msg.SessionID)
			handleIncomingAudio(msg.Payload)
			audio = append(audio, msg.Payload...)
		case MsgTypeError:
			glog.Exitf("Receive Error message (code=%d): %s", msg.ErrorCode, msg.Payload)
			return
		default:
			glog.Exitf("Received unexpected message type: %s", msg.Type)
			return
		}
	}
}

/**
 * 结合api接入文档对二进制协议进行理解，上下行统一理解
 * - header(4bytes)
 *     - (4bits)version(v1) + (4bits)header_size
 *     - (4bits)messageType + (4bits)messageTypeFlags
 *         -- 0001	CompleteClient  | -- 0001 optional has sequence
 *         -- 0010	AudioOnlyClient | -- 0100 optional has event
 *         -- 1001 CompleteServer   | -- 1111 optional has error code
 *         -- 1011 AudioOnlyServer  | --
 *     - (4bits)payloadFormat + (4bits)compression
 *     - (8bits) reserve
 * - payload
 *     - [optional 4 bytes] event
 *     - [optional] session ID
 *       -- (4 bytes)session ID len
 *       -- session ID data
 *     - (4 bytes)data len
 *     - data
 */
func receiveMessage(conn *websocket.Conn) (*Message, error) {
	mt, frame, err := conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	if mt != websocket.BinaryMessage && mt != websocket.TextMessage {
		return nil, fmt.Errorf("unexpected Websocket message type: %d", mt)
	}

	framePrefix := frame
	if len(frame) > 100 {
		framePrefix = frame[:100]
	}
	glog.Infof("Receive frame prefix: %v", framePrefix)
	msg, _, err := Unmarshal(frame, ContainsSequence)
	if err != nil {
		if len(frame) > 500 {
			frame = frame[:500]
		}
		glog.Infof("Data response: %s", frame)
		return nil, fmt.Errorf("unmarshal response message: %w", err)
	}
	return msg, nil
}

func startPlayer(ctx context.Context) {
	outputDevice, err := portaudio.DefaultOutputDevice()
	if err != nil {
		glog.Errorf("Failed to get default output device: %v", err)
		return
	}
	outputParameters := portaudio.StreamParameters{
		Output: portaudio.StreamDeviceParameters{
			Device:   outputDevice,
			Channels: channels,
			Latency:  10 * time.Millisecond,
		},
		SampleRate:      float64(sampleRate),
		FramesPerBuffer: framesPerBuffer,
	}
	outputStream, err := portaudio.OpenStream(outputParameters, func(out []float32) {
		bufferLock.Lock()
		defer bufferLock.Unlock()
		if len(buffer) < len(out) {
			copy(out, buffer)
			for i := len(buffer); i < len(out); i++ {
				out[i] = 0
			}
			buffer = buffer[:0]
		} else {
			copy(out, buffer)
			buffer = buffer[len(out):]
		}
	})
	if err != nil {
		glog.Errorf("Failed to open PortAudio output stream: %v", err)
		return
	}
	defer outputStream.Close()

	if err := outputStream.Start(); err != nil {
		glog.Errorf("Failed to start PortAudio output stream: %v", err)
		return
	}
	glog.Info("PortAudio output stream started for playback.")
	<-ctx.Done()
	saveAudioToPCMFile("output.pcm")
	glog.Info("PortAudio output stream stopped.")
}

func handleIncomingAudio(data []byte) {
	glog.Infof("Received audio byte len: %d, float32 len: %d", len(data), len(data)/4)
	sampleCount := len(data) / 4
	samples := make([]float32, sampleCount)
	for i := 0; i < sampleCount; i++ {
		bits := binary.LittleEndian.Uint32(data[i*4 : (i+1)*4])
		samples[i] = math.Float32frombits(bits)
	}
	// 将音频加载到缓冲区
	bufferLock.Lock()
	defer bufferLock.Unlock()
	buffer = append(buffer, samples...)
	if len(buffer) > sampleRate*bufferSeconds {
		buffer = buffer[len(buffer)-(sampleRate*bufferSeconds):]
	}
}

func saveAudioToPCMFile(s string) {
	if len(audio) == 0 {
		glog.Info("No audio data to save.")
		return
	}
	pcmPath := filepath.Join("./", s)
	if err := os.WriteFile(pcmPath, audio, 0644); err != nil {
		glog.Exitf("Save pcm file: %v", err)
	}
}
