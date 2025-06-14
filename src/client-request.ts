import WebSocket from 'ws';
import {BinaryProtocol, Message, MsgType, MsgTypeFlagBits, SerializationBits} from './protocol';
import {networkLogger, protocolLogger} from './logger';

export interface StartSessionPayload {
    tts?: TTSPayload;
    dialog: DialogPayload;
}

export interface SayHelloPayload {
    content: string;
}

export interface ChatTTSTextPayload {
    start: boolean;
    end: boolean;
    content: string;
}

export interface TTSPayload {
    audio_config: AudioConfig;
}

export interface AudioConfig {
    channel: number;
    format: string;
    sample_rate: number;
}

export interface DialogPayload {
    bot_name: string;
    dialog_id?: string;
    extra?: Record<string, any>;
}

export async function startConnection(conn: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        const msg = new Message(MsgType.FullClient, MsgTypeFlagBits.WithEvent);
        msg.event = 1;
        msg.payload = Buffer.from('{}');

        const protocol = new BinaryProtocol();
        protocol.setVersion(0b0001 << 4);
        protocol.setHeaderSize(1);
        protocol.setSerialization(SerializationBits.JSON);
        protocol.setCompression(0);

        protocol.marshal(msg).then(frame => {
            protocolLogger.debug('StartConnection frame created', `${frame.length} bytes`);

            conn.send(frame);
            networkLogger.info('StartConnection request sent');

            // Wait for ConnectionStarted response
            const messageHandler = (data: Buffer) => {
                try {
                    const {message} = BinaryProtocol.unmarshal(data);
                    if (message.type !== MsgType.FullServer) {
                        reject(new Error(`Unexpected ConnectionStarted message type: ${message.type}`));
                        return;
                    }
                    if (message.event !== 50) {
                        reject(new Error(`Unexpected response event (${message.event}) for StartConnection request`));
                        return;
                    }
                    networkLogger.connection('established', `ID: ${message.connectID}`);
                    conn.removeListener('message', messageHandler);
                    resolve();
                } catch (error) {
                    conn.removeListener('message', messageHandler);
                    reject(new Error(`Unmarshal ConnectionStarted response message: ${error}`));
                }
            };

            conn.on('message', messageHandler);
        }).catch(reject);
    });
}

export async function startSession(conn: WebSocket, sessionID: string, req: StartSessionPayload): Promise<void> {
    return new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(req));

        const msg = new Message(MsgType.FullClient, MsgTypeFlagBits.WithEvent);
        msg.event = 100;
        msg.sessionID = sessionID;
        msg.payload = payload;

        const protocol = new BinaryProtocol();
        protocol.setVersion(0b0001 << 4);
        protocol.setHeaderSize(1);
        protocol.setSerialization(SerializationBits.JSON);
        protocol.setCompression(0);

        protocol.marshal(msg).then(frame => {
            protocolLogger.debug('StartSession frame created', `${frame.length} bytes`);

            conn.send(frame);
            networkLogger.session('start request sent', sessionID);

            // Wait for SessionStarted response
            const messageHandler = (data: Buffer) => {
                try {
                    const {message} = BinaryProtocol.unmarshal(data);
                    if (message.type !== MsgType.FullServer) {
                        reject(new Error(`Unexpected SessionStarted message type: ${message.type}`));
                        return;
                    }
                    if (message.event !== 150) {
                        reject(new Error(`Unexpected response event (${message.event}) for StartSession request`));
                        return;
                    }
                    networkLogger.session('started', sessionID, message.payload.toString());
                    conn.removeListener('message', messageHandler);
                    resolve();
                } catch (error) {
                    conn.removeListener('message', messageHandler);
                    reject(new Error(`Unmarshal SessionStarted response message: ${error}`));
                }
            };

            conn.on('message', messageHandler);
        }).catch(reject);
    });
}

export async function sayHello(conn: WebSocket, sessionID: string, req: SayHelloPayload): Promise<void> {
    const payload = Buffer.from(JSON.stringify(req));
    console.log('SayHello request payload:', payload.toString());

    const msg = new Message(MsgType.FullClient, MsgTypeFlagBits.WithEvent);
    msg.event = 300;
    msg.sessionID = sessionID;
    msg.payload = payload;

    const protocol = new BinaryProtocol();
    protocol.setVersion(0b0001 << 4);
    protocol.setHeaderSize(1);
    protocol.setSerialization(SerializationBits.JSON);
    protocol.setCompression(0);

    const frame = await protocol.marshal(msg);
    console.log('SayHello frame:', Array.from(frame));

    conn.send(frame);
}

export async function chatTTSText(conn: WebSocket, sessionID: string, req: ChatTTSTextPayload): Promise<void> {
    const payload = Buffer.from(JSON.stringify(req));
    console.log('ChatTTSText request payload:', payload.toString());

    const msg = new Message(MsgType.FullClient, MsgTypeFlagBits.WithEvent);
    msg.event = 500;
    msg.sessionID = sessionID;
    msg.payload = payload;

    const protocol = new BinaryProtocol();
    protocol.setVersion(0b0001 << 4);
    protocol.setHeaderSize(1);
    protocol.setSerialization(SerializationBits.JSON);
    protocol.setCompression(0);

    const frame = await protocol.marshal(msg);
    console.log('ChatTTSText frame:', Array.from(frame));

    conn.send(frame);
}

export async function sendAudio(conn: WebSocket, sessionID: string, audioData: Buffer): Promise<void> {
    const protocol = new BinaryProtocol();
    protocol.setVersion(0b0001 << 4);
    protocol.setHeaderSize(1);
    protocol.setSerialization(SerializationBits.Raw);
    protocol.setCompression(0);

    const msg = new Message(MsgType.AudioOnlyClient, MsgTypeFlagBits.WithEvent);
    msg.event = 200;
    msg.sessionID = sessionID;
    msg.payload = audioData;

    const frame = await protocol.marshal(msg);
    conn.send(frame);
    protocolLogger.debug('Audio frame sent', `${audioData.length} bytes`);
}

export async function finishSession(conn: WebSocket, sessionID: string): Promise<void> {
    const msg = new Message(MsgType.FullClient, MsgTypeFlagBits.WithEvent);
    msg.event = 102;
    msg.sessionID = sessionID;
    msg.payload = Buffer.from('{}');

    const protocol = new BinaryProtocol();
    protocol.setVersion(0b0001 << 4);
    protocol.setHeaderSize(1);
    protocol.setSerialization(SerializationBits.JSON);
    protocol.setCompression(0);

    const frame = await protocol.marshal(msg);
    conn.send(frame);
    networkLogger.session('finish request sent', sessionID);
}

export async function finishConnection(conn: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        const msg = new Message(MsgType.FullClient, MsgTypeFlagBits.WithEvent);
        msg.event = 2;
        msg.payload = Buffer.from('{}');

        const protocol = new BinaryProtocol();
        protocol.setVersion(0b0001 << 4);
        protocol.setHeaderSize(1);
        protocol.setSerialization(SerializationBits.JSON);
        protocol.setCompression(0);

        protocol.marshal(msg).then(frame => {
            conn.send(frame);

            // Wait for ConnectionFinished response
            const messageHandler = (data: Buffer) => {
                try {
                    const {message} = BinaryProtocol.unmarshal(data);
                    if (message.type !== MsgType.FullServer) {
                        reject(new Error(`Unexpected ConnectionFinished message type: ${message.type}`));
                        return;
                    }
                    if (message.event !== 52) {
                        reject(new Error(`Unexpected response event (${message.event}) for FinishConnection request`));
                        return;
                    }
                    networkLogger.connection('finished');
                    conn.removeListener('message', messageHandler);
                    resolve();
                } catch (error) {
                    conn.removeListener('message', messageHandler);
                    reject(new Error(`Unmarshal ConnectionFinished response message: ${error}`));
                }
            };

            conn.on('message', messageHandler);
        }).catch(reject);
    });
}