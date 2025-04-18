import { WebApiGroupNoticeFeed } from '@/core';
import { OneBotAction } from '@/onebot/action/OneBotAction';
import { ActionName } from '@/onebot/action/router';
import { z } from 'zod';
interface GroupNotice {
    sender_id: number;
    publish_time: number;
    notice_id: string;
    message: {
        text: string
        image: Array<{
            height: string
            width: string
            id: string
        }>
    };
}

const SchemaData = z.object({
    group_id: z.coerce.string(),
});

type Payload = z.infer<typeof SchemaData>;

type ApiGroupNotice = GroupNotice & WebApiGroupNoticeFeed;

export class GetGroupNotice extends OneBotAction<Payload, GroupNotice[]> {
    override actionName = ActionName.GoCQHTTP_GetGroupNotice;
    override payloadSchema = SchemaData;

    async _handle(payload: Payload) {
        const group = payload.group_id.toString();
        const ret = await this.core.apis.WebApi.getGroupNotice(group);
        if (!ret) {
            throw new Error('获取公告失败');
        }
        const retNotices: GroupNotice[] = new Array<ApiGroupNotice>();
        for (const key in ret.feeds) {
            if (!ret.feeds[key]) {
                continue;
            }
            const retApiNotice: WebApiGroupNoticeFeed = ret.feeds[key];
            const retNotice: GroupNotice = {
                notice_id: retApiNotice.fid,
                sender_id: retApiNotice.u,
                publish_time: retApiNotice.pubt,
                message: {
                    text: retApiNotice.msg.text,
                    image: retApiNotice.msg.pics?.map((pic) => {
                        return { id: pic.id, height: pic.h, width: pic.w };
                    }) || [],
                },
            };
            retNotices.push(retNotice);
        }

        return retNotices;
    }
}
