import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Message, MsgType, BinaryProtocol, containsSequence } from './protocol';
import { audioLogger, networkLogger, logger } from './logger';
import Speaker from '@mastra/node-speaker';

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BUFFER_SECONDS = 100;

let audioBufferData: Buffer[] = [];
let audioBuffer: Float32Array = new Float32Array(0);
let bufferMaxSize = SAMPLE_RATE * BUFFER_SECONDS;

export function receiveMessage(data: Buffer): Message {
  networkLogger.debug('Received frame', `${data.length} bytes`);
  
  const { message } = BinaryProtocol.unmarshal(data, containsSequence);
  return message;
}

function handleServerMessage(msg: Message): void {
  try {
    const payload = JSON.parse(msg.payload.toString());
    
    switch (msg.event) {
      case 450:
        // ASR task started
        networkLogger.debug('ASR task started', payload.asr_task_id);
        break;
      case 451:
        // ASR result
        if (payload.results && payload.results[0]) {
          const result = payload.results[0];
          const text = result.text || '';
          const isInterim = result.is_interim;
          const isFinal = result.is_soft_finished || !isInterim;
          
          if (text && text.trim()) {
            if (isFinal) {
              console.log(`🗣️ You said: "${text}"`);
            }
          }
        }
        break;
      case 500:
        // TTS result
        if (payload.text) {
          console.log(`🤖 AI says: "${payload.text}"`);
        }
        break;
      default:
        networkLogger.debug(`Server event ${msg.event}`, payload);
    }
  } catch (error) {
    networkLogger.debug(`Server event ${msg.event}`, msg.payload.toString().slice(0, 100));
  }
}

export async function realtimeAPIOutputAudio(conn: WebSocket, onAudio?: (audio: Float32Array) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.on('message', (data: Buffer) => {
      try {
        const msg = receiveMessage(data);
        
        switch (msg.type) {
          case MsgType.FullServer:
            handleServerMessage(msg);
            
            // Session finished events
            if (msg.event === 152 || msg.event === 153) {
              networkLogger.session('finished by server');
              resolve();
              return;
            }
            
            // ASR info event, clear audio buffer
            if (msg.event === 450) {
              audioLogger.debug('ASR session started, clearing buffer');
              audioBufferData = [];
              audioBuffer = new Float32Array(0);
            }
            break;
            
          case MsgType.AudioOnlyServer:
            audioLogger.audio('received', msg.payload.length);
            handleIncomingAudio(msg.payload, onAudio);
            audioBufferData.push(msg.payload);
            break;
            
          case MsgType.Error:
            networkLogger.error(`Server error (code=${msg.errorCode})`, msg.payload.toString());
            reject(new Error(`Server error: ${msg.errorCode} - ${msg.payload.toString()}`));
            return;
            
          default:
            networkLogger.error('Unexpected message type', msg.type);
            reject(new Error(`Unexpected message type: ${msg.type}`));
            return;
        }
      } catch (error) {
        networkLogger.error('Message processing failed', error);
        reject(error);
      }
    });

    conn.on('error', (error) => {
      networkLogger.error('WebSocket error', error);
      reject(error);
    });

    conn.on('close', () => {
      networkLogger.connection('closed');
      resolve();
    });
  });
}

export function handleIncomingAudio(data: Buffer, onAudio?: (audio: Float32Array) => void): void {
  audioLogger.debug('Processing audio data', `${data.length} bytes → ${Math.floor(data.length / 4)} samples`);
  
  const sampleCount = Math.floor(data.length / 4);
  const samples = new Float32Array(sampleCount);
  
  for (let i = 0; i < sampleCount; i++) {
    const bits = data.readUInt32LE(i * 4);
    samples[i] = intBitsToFloat(bits);
  }
  
  // Add audio to buffer
  const newBuffer = new Float32Array(audioBuffer.length + samples.length);
  newBuffer.set(audioBuffer);
  newBuffer.set(samples, audioBuffer.length);
  audioBuffer = newBuffer;
  
  // Limit buffer size
  if (audioBuffer.length > bufferMaxSize) {
    audioBuffer = audioBuffer.slice(audioBuffer.length - bufferMaxSize);
  }
  
  // Call audio callback if provided
  if (onAudio) {
    onAudio(samples);
  }
}

export function saveAudioToPCMFile(filename: string = 'output.pcm'): void {
  if (audioBufferData.length === 0) {
    audioLogger.warn('No audio data to save');
    return;
  }
  
  const totalBuffer = Buffer.concat(audioBufferData);
  const pcmPath = path.join('./', filename);
  
  try {
    fs.writeFileSync(pcmPath, totalBuffer);
    audioLogger.info('Audio saved', `${pcmPath} (${formatBytes(totalBuffer.length)})`);
  } catch (error) {
    audioLogger.error('Failed to save audio file', error);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

// Helper function to convert int32 bits to float32 (IEEE 754)
function intBitsToFloat(bits: number): number {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(bits, 0);
  return buffer.readFloatLE(0);
}

// Audio playback using @mastra/node-speaker with proper error handling
export class AudioPlayer {
  private speaker: Speaker | null = null;
  private isPlaying = false;

  constructor() {
    this.initializeSpeaker();
  }

  private initializeSpeaker(): void {
    try {
      this.speaker = new Speaker({
        channels: CHANNELS,
        bitDepth: 16,
        sampleRate: SAMPLE_RATE
      });
      
      this.speaker.on('error', (error: Error) => {
        audioLogger.error('Speaker error', error.message);
        this.speaker = null;
      });

      audioLogger.info('Audio player initialized successfully');
    } catch (error) {
      audioLogger.warn('Speaker not available, audio will not be played', 
        error instanceof Error ? error.message : String(error));
      this.speaker = null;
    }
  }

  play(audioData: Float32Array): void {
    audioLogger.audio('received for playback', audioData.length);
    
    if (!this.speaker) {
      audioLogger.debug('Speaker not available, audio saved to file only');
      return;
    }

    try {
      // Convert Float32Array to 16-bit PCM Buffer
      const pcmBuffer = Buffer.alloc(audioData.length * 2);
      for (let i = 0; i < audioData.length; i++) {
        // Clamp and convert to 16-bit signed integer
        const sample = Math.max(-1, Math.min(1, audioData[i]));
        const int16Sample = Math.round(sample * 32767);
        pcmBuffer.writeInt16LE(int16Sample, i * 2);
      }

      this.speaker.write(pcmBuffer);
      audioLogger.audio('playing', audioData.length);
    } catch (error) {
      audioLogger.error('Failed to play audio', error instanceof Error ? error.message : String(error));
      // Try to reinitialize speaker on error
      this.initializeSpeaker();
    }
  }

  stop(): void {
    if (this.speaker) {
      try {
        this.speaker.end();
        audioLogger.info('Audio player stopped');
      } catch (error) {
        audioLogger.error('Error stopping audio player', error instanceof Error ? error.message : String(error));
      }
      this.speaker = null;
    }
    this.isPlaying = false;
  }
}