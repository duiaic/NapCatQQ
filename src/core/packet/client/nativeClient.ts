import { createHash } from 'crypto';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { IPacketClient } from '@/core/packet/client/baseClient';
import { constants } from 'node:os';
import { LRUCache } from '@/common/lru-cache';
import { LogStack } from '@/core/packet/context/clientContext';
import { NapCoreContext } from '@/core/packet/context/napCoreContext';
import { PacketLogger } from '@/core/packet/context/loggerContext';
import { ProtoBufDecode } from 'napcat.protobuf';
export const MsgData = new LRUCache<string, string>(5000);
// 0 send 1 recv
export interface NativePacketExportType {
    InitHook?: (send: string, recv: string, callback: (type: number, uin: string, cmd: string, seq: number, hex_data: string) => void, o3_hook: boolean) => boolean;
    SendPacket?: (cmd: string, data: string, trace_id: string) => void;
}

export class NativePacketClient extends IPacketClient {
    private readonly supportedPlatforms = ['win32.x64', 'linux.x64', 'linux.arm64', 'darwin.x64', 'darwin.arm64'];
    private readonly MoeHooExport: { exports: NativePacketExportType } = { exports: {} };
    private readonly sendEvent = new LRUCache<number, string>(500); // seq->trace_id

    constructor(napCore: NapCoreContext, logger: PacketLogger, logStack: LogStack) {
        super(napCore, logger, logStack);
    }

    check(): boolean {
        const platform = process.platform + '.' + process.arch;
        if (!this.supportedPlatforms.includes(platform)) {
            this.logStack.pushLogWarn(`NativePacketClient: 不支持的平台: ${platform}`);
            return false;
        }
        const moehoo_path = path.join(dirname(fileURLToPath(import.meta.url)), './moehoo/MoeHoo.' + platform + '.node');
        if (!fs.existsSync(moehoo_path)) {
            this.logStack.pushLogWarn(`NativePacketClient: 缺失运行时文件: ${moehoo_path}`);
            return false;
        }
        return true;
    }

    async init(_pid: number, recv: string, send: string): Promise<void> {
        const platform = process.platform + '.' + process.arch;
        const moehoo_path = path.join(dirname(fileURLToPath(import.meta.url)), './moehoo/MoeHoo.' + platform + '.node');
        process.dlopen(this.MoeHooExport, moehoo_path, constants.dlopen.RTLD_LAZY);

        this.MoeHooExport.exports.InitHook?.(send, recv, (type: number, _uin: string, cmd: string, seq: number, hex_data: string) => {
            const trace_id = createHash('md5').update(Buffer.from(hex_data, 'hex')).digest('hex');
            if (type === 0 && this.cb.get(trace_id + 'recv')) {
                //此时为send 提取seq
                this.sendEvent.put(seq, trace_id);
            }
            if (type === 1 && this.sendEvent.get(seq)) {
                //此时为recv 调用callback
                const trace_id = this.sendEvent.get(seq);
                const callback = this.cb.get(trace_id + 'recv');
                // console.log('callback:', callback, trace_id);
                callback?.({ seq, cmd, hex_data });
            }
            if (cmd === 'trpc.msg.olpush.OlPushService.MsgPush') {
                try {
                    let msg_info = ProtoBufDecode(Buffer.from(hex_data, 'hex')) as any;
                    let group_id = (msg_info['1']['1']['8']['1'] as number).toString()
                    let msg_seq = (msg_info['1']['2']['5'] as number).toString()
                    let msg_id = group_id + '_' + msg_seq;
                    MsgData.put(msg_id, hex_data);
                    console.log('add msgid:', msg_id);
                } catch (error) {
                    console.log('error:', error);
                }

            }
        }, this.napcore.config.o3HookMode == 1);
        this.available = true;
    }

    sendCommandImpl(cmd: string, data: string, trace_id: string): void {
        const trace_id_md5 = createHash('md5').update(trace_id).digest('hex');
        this.MoeHooExport.exports.SendPacket?.(cmd, data, trace_id_md5);
        this.cb.get(trace_id_md5 + 'send')?.({ seq: 0, cmd, hex_data: '' });
    }
}
