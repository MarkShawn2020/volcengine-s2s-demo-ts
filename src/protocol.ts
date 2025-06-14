export enum MsgType {
  Invalid = 0,
  FullClient = 1,
  AudioOnlyClient = 2,
  FullServer = 3,
  AudioOnlyServer = 4,
  FrontEndResultServer = 5,
  Error = 6,
  ServerACK = AudioOnlyServer
}

export enum MsgTypeFlagBits {
  NoSeq = 0,
  PositiveSeq = 0b1,
  LastNoSeq = 0b10,
  NegativeSeq = 0b11,
  WithEvent = 0b100
}

export enum VersionBits {
  Version1 = 0b0001 << 4,
  Version2 = 0b0010 << 4,
  Version3 = 0b0011 << 4,
  Version4 = 0b0100 << 4
}

export enum HeaderSizeBits {
  HeaderSize4 = 1,
  HeaderSize8 = 2,
  HeaderSize12 = 3,
  HeaderSize16 = 4
}

export enum SerializationBits {
  Raw = 0,
  JSON = 0b0001 << 4,
  Thrift = 0b0011 << 4,
  Custom = 0b1111 << 4
}

export enum CompressionBits {
  None = 0,
  Gzip = 0b0001,
  Custom = 0b1111
}

const msgTypeToBits = new Map<MsgType, number>([
  [MsgType.FullClient, 0b0001 << 4],
  [MsgType.AudioOnlyClient, 0b0010 << 4],
  [MsgType.FullServer, 0b1001 << 4],
  [MsgType.AudioOnlyServer, 0b1011 << 4],
  [MsgType.FrontEndResultServer, 0b1100 << 4],
  [MsgType.Error, 0b1111 << 4]
]);

const bitsToMsgType = new Map<number, MsgType>();
for (const [msgType, bits] of msgTypeToBits) {
  bitsToMsgType.set(bits, msgType);
}

export type ContainsSequenceFunc = (bits: MsgTypeFlagBits) => boolean;
export type CompressFunc = (data: Buffer) => Promise<Buffer>;

export class Message {
  type: MsgType;
  typeAndFlagBits: number;
  event: number = 0;
  sessionID: string = '';
  connectID: string = '';
  sequence: number = 0;
  errorCode: number = 0;
  payload: Buffer = Buffer.alloc(0);

  constructor(msgType: MsgType, typeFlag: MsgTypeFlagBits) {
    const bits = msgTypeToBits.get(msgType);
    if (bits === undefined) {
      throw new Error(`Invalid message type: ${msgType}`);
    }
    this.type = msgType;
    this.typeAndFlagBits = bits + typeFlag;
  }

  static fromByte(typeAndFlag: number): Message {
    const bits = typeAndFlag & ~0b00001111;
    const msgType = bitsToMsgType.get(bits);
    if (msgType === undefined) {
      throw new Error(`Invalid message type bits: ${(bits >> 4).toString(2)}`);
    }
    const msg = Object.create(Message.prototype);
    msg.type = msgType;
    msg.typeAndFlagBits = typeAndFlag;
    msg.event = 0;
    msg.sessionID = '';
    msg.connectID = '';
    msg.sequence = 0;
    msg.errorCode = 0;
    msg.payload = Buffer.alloc(0);
    return msg;
  }

  getTypeFlag(): MsgTypeFlagBits {
    return this.typeAndFlagBits & ~0b11110000;
  }
}

export class BinaryProtocol {
  private versionAndHeaderSize: number = 0;
  private serializationAndCompression: number = 0;
  private containsSequenceFunc?: ContainsSequenceFunc;
  private compressFunc?: CompressFunc;

  setVersion(v: VersionBits): void {
    this.versionAndHeaderSize = (this.versionAndHeaderSize & ~0b11110000) + v;
  }

  getVersion(): number {
    return this.versionAndHeaderSize >> 4;
  }

  setHeaderSize(s: HeaderSizeBits): void {
    this.versionAndHeaderSize = (this.versionAndHeaderSize & ~0b00001111) + s;
  }

  getHeaderSize(): number {
    return 4 * (this.versionAndHeaderSize & ~0b11110000);
  }

  setSerialization(s: SerializationBits): void {
    this.serializationAndCompression = (this.serializationAndCompression & ~0b11110000) + s;
  }

  getSerialization(): SerializationBits {
    return this.serializationAndCompression & ~0b00001111;
  }

  setCompression(c: CompressionBits, f?: CompressFunc): void {
    this.serializationAndCompression = (this.serializationAndCompression & ~0b00001111) + c;
    this.compressFunc = f;
  }

  getCompression(): CompressionBits {
    return this.serializationAndCompression & ~0b11110000;
  }

  setContainsSequence(func: ContainsSequenceFunc): void {
    this.containsSequenceFunc = func;
  }

  async marshal(msg: Message): Promise<Buffer> {
    const buffer = Buffer.alloc(0);
    const chunks: Buffer[] = [];

    // Write header
    const header = this.createHeader(msg);
    chunks.push(header);

    // Compress payload if needed
    if (this.compressFunc && msg.payload.length > 0) {
      msg.payload = await this.compressFunc(msg.payload);
    }

    // Write data based on message type and flags
    if (this.containsSequenceFunc && this.containsSequenceFunc(msg.getTypeFlag())) {
      chunks.push(this.writeInt32(msg.sequence));
    }

    if (this.containsEvent(msg.getTypeFlag())) {
      chunks.push(this.writeInt32(msg.event));
      
      // Write session ID for certain events
      if (![1, 2, 50, 51, 52].includes(msg.event)) {
        chunks.push(this.writeString(msg.sessionID));
      }
    }

    // Write payload
    chunks.push(this.writeInt32(msg.payload.length));
    if (msg.payload.length > 0) {
      chunks.push(msg.payload);
    }

    return Buffer.concat(chunks);
  }

  static unmarshal(data: Buffer, containsSequence?: ContainsSequenceFunc): { message: Message; protocol: BinaryProtocol } {
    let offset = 0;

    if (data.length < 1) {
      throw new Error('No protocol version and header size byte');
    }

    const versionSize = data.readUInt8(offset++);
    const protocol = new BinaryProtocol();
    protocol.versionAndHeaderSize = versionSize;
    protocol.containsSequenceFunc = containsSequence;

    if (data.length < 2) {
      throw new Error('No message type and specific flag byte');
    }

    const typeAndFlag = data.readUInt8(offset++);
    const msg = Message.fromByte(typeAndFlag);

    if (data.length < 3) {
      throw new Error('No serialization and compression method byte');
    }

    const serializationCompression = data.readUInt8(offset++);
    protocol.serializationAndCompression = serializationCompression;

    // Skip padding bytes in header
    const headerSize = protocol.getHeaderSize();
    const paddingSize = headerSize - 3;
    if (paddingSize > 0) {
      if (data.length < offset + paddingSize) {
        throw new Error(`No enough header bytes: ${data.length - offset}`);
      }
      offset += paddingSize;
    }

    // Read message content based on type
    switch (msg.type) {
      case MsgType.AudioOnlyClient:
        if (containsSequence && containsSequence(msg.getTypeFlag())) {
          msg.sequence = data.readInt32BE(offset);
          offset += 4;
        }
        break;
      case MsgType.AudioOnlyServer:
        if (containsSequence && containsSequence(msg.getTypeFlag())) {
          msg.sequence = data.readInt32BE(offset);
          offset += 4;
        }
        break;
      case MsgType.Error:
        msg.errorCode = data.readUInt32BE(offset);
        offset += 4;
        break;
    }

    // Read event and session ID if present
    if (protocol.containsEvent(msg.getTypeFlag())) {
      msg.event = data.readInt32BE(offset);
      offset += 4;

      // Read session ID for certain events
      if (![1, 2, 50, 51, 52].includes(msg.event)) {
        const sessionIDSize = data.readUInt32BE(offset);
        offset += 4;
        if (sessionIDSize > 0) {
          msg.sessionID = data.subarray(offset, offset + sessionIDSize).toString();
          offset += sessionIDSize;
        }
      }

      // Read connect ID for certain events
      if ([50, 51, 52].includes(msg.event)) {
        const connectIDSize = data.readUInt32BE(offset);
        offset += 4;
        if (connectIDSize > 0) {
          msg.connectID = data.subarray(offset, offset + connectIDSize).toString();
          offset += connectIDSize;
        }
      }
    }

    // Read payload
    const payloadSize = data.readUInt32BE(offset);
    offset += 4;
    if (payloadSize > 0) {
      msg.payload = data.subarray(offset, offset + payloadSize);
    }

    return { message: msg, protocol };
  }

  private createHeader(msg: Message): Buffer {
    const header = Buffer.alloc(this.getHeaderSize());
    header.writeUInt8(this.versionAndHeaderSize, 0);
    header.writeUInt8(msg.typeAndFlagBits, 1);
    header.writeUInt8(this.serializationAndCompression, 2);
    // Rest of header is zero-padded
    return header;
  }

  private writeInt32(value: number): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value, 0);
    return buffer;
  }

  private writeString(str: string): Buffer {
    const strBuffer = Buffer.from(str);
    const sizeBuffer = Buffer.alloc(4);
    sizeBuffer.writeUInt32BE(strBuffer.length, 0);
    return Buffer.concat([sizeBuffer, strBuffer]);
  }

  private containsEvent(bits: MsgTypeFlagBits): boolean {
    return (bits & MsgTypeFlagBits.WithEvent) === MsgTypeFlagBits.WithEvent;
  }
}

export function containsSequence(bits: MsgTypeFlagBits): boolean {
  return (bits & MsgTypeFlagBits.PositiveSeq) === MsgTypeFlagBits.PositiveSeq ||
         (bits & MsgTypeFlagBits.NegativeSeq) === MsgTypeFlagBits.NegativeSeq;
}

export function newBinaryProtocol(): BinaryProtocol {
  const protocol = new BinaryProtocol();
  protocol.setVersion(VersionBits.Version1);
  protocol.setHeaderSize(HeaderSizeBits.HeaderSize4);
  protocol.setSerialization(SerializationBits.JSON);
  protocol.setCompression(CompressionBits.None);
  protocol.setContainsSequence(containsSequence);
  return protocol;
}