import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { audioLogger, logger } from './logger';
// @ts-expect-error
import {record} from 'node-record-lpcm16'

export interface AudioInputOptions {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  device?: string;
}

export class MicrophoneInput extends EventEmitter {
  private recorder: any;
  private isRecording = false;
  private options: Required<AudioInputOptions>;

  constructor(options: AudioInputOptions = {}) {
    super();
    this.options = {
      sampleRate: options.sampleRate || 16000,
      channels: options.channels || 1,
      bitDepth: options.bitDepth || 16,
      device: options.device || 'default'
    };
  }

  start(): void {
    if (this.isRecording) {
      audioLogger.warn('Recording already in progress');
      return;
    }

    try {
      // Try to use node-record-lpcm16 first  
      this.recorder = record({
        sampleRateHertz: this.options.sampleRate,
        threshold: 0.5,
        verbose: false,
        recordProgram: 'rec', // Use SoX rec command
        silence: '1.0',
        channels: this.options.channels
      });

      this.recorder.stream()
        .on('data', (chunk: Buffer) => {
          this.emit('data', chunk);
        })
        .on('error', (err: Error) => {
          audioLogger.error('Recording error', err);
          this.emit('error', err);
        });

      this.isRecording = true;
      audioLogger.info('Microphone recording started', `${this.options.sampleRate}Hz, ${this.options.channels}ch`);
      this.emit('start');

    } catch (error) {
      audioLogger.warn('node-record-lpcm16 failed, falling back to ffmpeg', error);
      this.startWithFFmpeg();
    }
  }

  private startWithFFmpeg(): void {
    // Fallback to ffmpeg if node-record-lpcm16 fails
    const ffmpegArgs = [
      '-f', 'avfoundation',  // macOS input format
      '-i', ':0',            // Use default microphone (device 0)
      '-ar', this.options.sampleRate.toString(),
      '-ac', this.options.channels.toString(),
      '-f', 's16le',         // 16-bit little-endian PCM
      '-'                    // Output to stdout
    ];

    this.recorder = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.recorder.stdout.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
    });

    this.recorder.stderr.on('data', (data: Buffer) => {
      // FFmpeg outputs info to stderr, only log errors
      const message = data.toString();
      if (message.includes('error') || message.includes('Error')) {
        audioLogger.error('FFmpeg error', message);
      }
    });

    this.recorder.on('error', (err: Error) => {
      audioLogger.error('FFmpeg recording error', err);
      this.emit('error', err);
    });

    this.recorder.on('close', (code: number) => {
      audioLogger.info('FFmpeg recording process exited', `code ${code}`);
      this.isRecording = false;
      this.emit('stop');
    });

    this.isRecording = true;
    audioLogger.info('FFmpeg recording started', `${this.options.sampleRate}Hz via avfoundation`);
    this.emit('start');
  }

  stop(): void {
    if (!this.isRecording) {
      return;
    }

    if (this.recorder) {
      if (typeof this.recorder.stop === 'function') {
        // node-record-lpcm16
        this.recorder.stop();
      } else if (this.recorder.kill) {
        // ffmpeg process
        this.recorder.kill('SIGTERM');
      }
    }

    this.isRecording = false;
    audioLogger.info('Microphone recording stopped');
    this.emit('stop');
  }

  isActive(): boolean {
    return this.isRecording;
  }
}

// Factory function for easy use
export function createMicrophoneInput(options?: AudioInputOptions): MicrophoneInput {
  return new MicrophoneInput(options);
}