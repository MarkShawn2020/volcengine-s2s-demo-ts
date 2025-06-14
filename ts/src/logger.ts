export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private prefix: string;
  private lastMessage: string = '';
  private repeatCount: number = 0;

  constructor(module?: string) {
    this.prefix = module ? `[${module}]` : '[App]';
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: string, message: string, ...args: any[]): string | null {
    const timestamp = new Date().toISOString().slice(11, 19); // HH:mm:ss
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? this.truncateObject(arg) : String(arg)
    ).join(' ') : '';
    
    const fullMessage = `${message}${formattedArgs}`;
    
    // Handle repeated messages
    if (fullMessage === this.lastMessage) {
      this.repeatCount++;
      return null; // Don't log repeated messages immediately
    } else {
      let result = `${timestamp} ${level} ${this.prefix} ${fullMessage}`;
      if (this.repeatCount > 0) {
        result = `${timestamp} ${level} ${this.prefix} [Last message repeated ${this.repeatCount} times]\n` + result;
        this.repeatCount = 0;
      }
      this.lastMessage = fullMessage;
      return result;
    }
  }

  private truncateObject(obj: any): string {
    const str = JSON.stringify(obj);
    if (str.length > 100) {
      return str.substring(0, 97) + '...';
    }
    return str;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formatted = this.formatMessage('🔍', message, ...args);
      if (formatted) console.log(formatted);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formatted = this.formatMessage('ℹ️', message, ...args);
      if (formatted) console.log(formatted);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formatted = this.formatMessage('⚠️', message, ...args);
      if (formatted) console.warn(formatted);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formatted = this.formatMessage('❌', message, ...args);
      if (formatted) console.error(formatted);
    }
  }

  // Special methods for common scenarios
  connection(action: string, details?: any): void {
    this.info(`🔗 Connection ${action}`, details || '');
  }

  session(action: string, sessionId?: string, details?: any): void {
    const sessionInfo = sessionId ? ` [${sessionId.slice(0, 8)}...]` : '';
    this.info(`📡 Session ${action}${sessionInfo}`, details || '');
  }

  audio(action: string, size?: number, details?: any): void {
    // Only log audio events at debug level to reduce noise
    if (action === 'sent' || action === 'received') {
      this.debug(`🎵 Audio ${action}`, size ? this.formatBytes(size) : '');
    } else {
      const sizeInfo = size ? ` (${this.formatBytes(size)})` : '';
      this.info(`🎵 Audio ${action}${sizeInfo}`, details || '');
    }
  }

  microphone(action: string, details?: any): void {
    this.info(`🎤 Microphone ${action}`, details || '');
  }

  protocol(action: string, type?: string, details?: any): void {
    const typeInfo = type ? ` [${type}]` : '';
    this.debug(`📦 Protocol ${action}${typeInfo}`, details || '');
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
  }

  // Utility method for progress indicators
  progress(current: number, total: number, operation: string): void {
    const percentage = Math.round((current / total) * 100);
    const progressBar = '█'.repeat(Math.floor(percentage / 10)) + '░'.repeat(10 - Math.floor(percentage / 10));
    this.info(`📊 ${operation} [${progressBar}] ${percentage}%`);
  }

  // Method for API responses
  response(status: 'success' | 'error', operation: string, details?: any): void {
    if (status === 'success') {
      this.info(`✅ ${operation} completed`, details);
    } else {
      this.error(`❌ ${operation} failed`, details);
    }
  }
}

// Create logger instances for different modules
export const createLogger = (module?: string): Logger => new Logger(module);

// Default loggers for main modules
export const mainLogger = createLogger('Main');
export const protocolLogger = createLogger('Protocol');
export const audioLogger = createLogger('Audio');
export const networkLogger = createLogger('Network');

// Global logger for general use
export const logger = createLogger();

// Set debug level from environment, default to INFO for better UX
const defaultLevel = LogLevel.INFO;
if (process.env.LOG_LEVEL) {
  const level = LogLevel[process.env.LOG_LEVEL.toUpperCase() as keyof typeof LogLevel];
  if (level !== undefined) {
    logger.setLevel(level);
    mainLogger.setLevel(level);
    protocolLogger.setLevel(level);
    audioLogger.setLevel(level);
    networkLogger.setLevel(level);
  }
} else {
  // Set default levels for a clean user experience
  logger.setLevel(defaultLevel);
  mainLogger.setLevel(defaultLevel);
  protocolLogger.setLevel(LogLevel.WARN);
  audioLogger.setLevel(LogLevel.WARN);
  networkLogger.setLevel(defaultLevel);
}