import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'readline';
import { mainLogger, logger } from './logger';
import { 
  startConnection, 
  startSession, 
  finishConnection, 
  finishSession,
  sendAudio,
  StartSessionPayload 
} from './client-request';
import { realtimeAPIOutputAudio, AudioPlayer, saveAudioToPCMFile } from './server-response';
import { createMicrophoneInput, MicrophoneInput } from './audio-input';

// Configuration
const APP_ID = "9168491271";
const ACCESS_TOKEN = "YOUR_API_KEY_HERE";
const WS_URL = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

const headers = {
  "X-Api-Resource-Id": "volc.speech.dialog",
  "X-Api-Access-Key": ACCESS_TOKEN,
  "X-Api-App-Key": "PlgvMymc7f3tQnJ6",
  "X-Api-App-ID": APP_ID,
  "X-Api-Connect-Id": uuidv4()
};

async function realTimeDialog(sessionID: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new WebSocket(WS_URL, {
      headers
    });

    conn.on('open', async () => {
      try {
        mainLogger.connection('opened');
        
        // Start connection
        await startConnection(conn);
        mainLogger.connection('established');

        // Start session
        const extra = {
          strict_audit: false
        };

        const sessionPayload: StartSessionPayload = {
          // todo: ogg-opus-decoder
          tts: {
            audio_config: {
              channel: 1,
              format: "pcm",
              sample_rate: 24000
            }
          },
          dialog: {
            bot_name: "豆包",
            extra
          }
        };

        await startSession(conn, sessionID, sessionPayload);
        mainLogger.session('started', sessionID);

        // Create audio player
        const audioPlayer = new AudioPlayer();

        // Start receiving audio output
        const audioPromise = realtimeAPIOutputAudio(conn, (audioData) => {
          audioPlayer.play(audioData);
        });

        // Set up real microphone input
        startRealMicrophone(conn, sessionID);

        // Wait for session to complete
        await audioPromise;
        
        // Finish connection
        await finishConnection(conn);
        mainLogger.session('finished', sessionID);
        
        // Save audio output
        saveAudioToPCMFile('output.pcm');
        
        resolve();
      } catch (error) {
        mainLogger.error('Dialog failed', error);
        reject(error);
      }
    });

    conn.on('error', (error) => {
      mainLogger.error('WebSocket error', error);
      reject(error);
    });

    conn.on('close', (code, reason) => {
      mainLogger.connection(`closed (${code})`, reason.toString());
      resolve();
    });
  });
}

function startRealMicrophone(conn: WebSocket, sessionID: string): void {
  const mic = createMicrophoneInput({
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16
  });

  mic.on('start', () => {
    console.log('🎤 Microphone ready - start speaking!');
  });

  mic.on('data', async (audioChunk: Buffer) => {
    try {
      await sendAudio(conn, sessionID, audioChunk);
      mainLogger.audio('sent', audioChunk.length);
    } catch (error) {
      mainLogger.error('Failed to send audio', error);
    }
  });

  mic.on('error', (error: Error) => {
    mainLogger.error('Microphone error', error);
  });

  mic.on('stop', async () => {
    mainLogger.microphone('stopped');
    try {
      await finishSession(conn, sessionID);
    } catch (error) {
      mainLogger.error('Failed to finish session', error);
    }
  });

  // Start recording
  mic.start();

  // Set up graceful shutdown for microphone
  const cleanup = () => {
    mainLogger.info('Stopping microphone...');
    mic.stop();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// Keep the simulation function for fallback
function startMicrophoneSimulation(conn: WebSocket, sessionID: string): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\nMicrophone simulation started. Press Enter to send audio data, type "quit" to exit...');
  
  let audioSequence = 0;
  
  const promptUser = () => {
    rl.question('Press Enter to send audio data (or "quit" to exit): ', async (input) => {
      if (input.toLowerCase() === 'quit') {
        rl.close();
        try {
          await finishSession(conn, sessionID);
        } catch (error) {
          console.error('Error finishing session:', error);
        }
        return;
      }

      // Simulate audio data (in a real implementation, this would come from microphone)
      const sampleRate = 16000;
      const durationMs = 1000; // 1 second
      const sampleCount = Math.floor(sampleRate * durationMs / 1000);
      const audioData = Buffer.alloc(sampleCount * 2); // 16-bit PCM

      // Generate some test audio (sine wave)
      for (let i = 0; i < sampleCount; i++) {
        const frequency = 440; // A note
        const amplitude = 0.3;
        const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
        const int16Sample = Math.round(sample * 32767);
        audioData.writeInt16LE(int16Sample, i * 2);
      }

      try {
        await sendAudio(conn, sessionID, audioData);
        console.log(`Sent ${audioData.length} bytes of audio data`);
        audioSequence++;
      } catch (error) {
        console.error('Error sending audio:', error);
      }

      promptUser();
    });
  };

  promptUser();
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting VolcEngine Speech-to-Speech Demo');
    console.log('💬 说话开始录音，按 Ctrl+C 结束会话\n');
    
    const sessionID = uuidv4();
    mainLogger.debug('Session ID', sessionID);
    
    await realTimeDialog(sessionID);
    
    console.log('\n✅ Demo completed successfully');
  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  mainLogger.info('Received SIGINT, shutting down gracefully...');
  saveAudioToPCMFile('output.pcm');
  process.exit(0);
});

process.on('SIGTERM', () => {
  mainLogger.info('Received SIGTERM, shutting down gracefully...');
  saveAudioToPCMFile('output.pcm');
  process.exit(0);
});

if (require.main === module) {
  main();
}