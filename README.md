# VolcEngine Speech-to-Speech Demo (TypeScript/Node.js)

This is a TypeScript/Node.js implementation of the VolcEngine Speech-to-Speech API demo, converted from the original Go version.

## Features

- Real-time speech-to-speech communication with VolcEngine API
- Binary protocol implementation for efficient data transmission
- WebSocket-based connection with proper message handling
- Audio input/output simulation
- Session management with proper connection lifecycle

## Prerequisites

- Node.js 16 or higher
- npm or yarn package manager

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

## Usage

### Development mode (with TypeScript):
```bash
npm run dev
```

### Production mode (compiled JavaScript):
```bash
npm start
```

## Project Structure

```
src/
   main.ts              # Main application entry point
   protocol.ts          # Binary protocol implementation
   client-request.ts    # Client request functions
   server-response.ts   # Server response handling
```

## Configuration

The demo uses the following default configuration:
- App ID: `9168491271`
- Access Token: `JLkKmktomgAYHniHPpUye4qB01zZg6R9`
- WebSocket URL: `wss://openspeech.bytedance.com/api/v3/realtime/dialogue`

## Audio Handling

The current implementation includes:
- Simulated microphone input (sine wave generation)
- Real-time audio output handling
- PCM audio file saving for received audio

For production use, you would need to integrate with actual audio capture/playback libraries such as:
- `node-record-lpcm16` for microphone input
- `node-speaker` for audio output
- `node-portaudio` for cross-platform audio I/O

## Protocol Implementation

The binary protocol implementation includes:
- Message type definitions and encoding/decoding
- Proper header structure with version, size, and flags
- Serialization support (JSON, Raw, Thrift)
- Compression support framework
- Sequence number handling for audio streams

## API Events

The implementation handles various events:
- Connection lifecycle (start/finish)
- Session management (start/finish)
- Audio streaming (input/output)
- Text messages and responses
- Error handling

## Error Handling

The demo includes comprehensive error handling for:
- WebSocket connection errors
- Protocol parsing errors
- API response errors
- Session management errors

## Output

The demo saves received audio data to `output.pcm` file for analysis and playback.

## Notes

- This is a demo implementation for educational purposes
- For production use, proper authentication and error recovery should be implemented
- Audio quality and real-time performance optimizations may be needed
- The microphone simulation generates test audio data - replace with actual audio capture for real use