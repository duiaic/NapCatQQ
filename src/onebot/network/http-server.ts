import { OB11EmitEventContent, OB11NetworkReloadType } from './index';
import { Context, Hono, Next } from 'hono';
import { NapCatCore } from '@/core';
import { OB11Response } from '@/onebot/action/OneBotAction';
import { ActionMap } from '@/onebot/action';
import { cors } from 'hono/cors';
import { HttpServerConfig } from '@/onebot/config/config';
import { NapCatOneBot11Adapter } from '@/onebot';
import { IOB11NetworkAdapter } from '@/onebot/network/adapter';
import { serve } from '@hono/node-server';

export class OB11HttpServerAdapter extends IOB11NetworkAdapter<HttpServerConfig> {
    private app: Hono | undefined;
    private server: ReturnType<typeof serve> | undefined;

    constructor(name: string, config: HttpServerConfig, core: NapCatCore, obContext: NapCatOneBot11Adapter, actions: ActionMap) {
        super(name, config, core, obContext, actions);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    override onEvent<T extends OB11EmitEventContent>(_event: T) {
        // http server is passive, no need to emit event
    }

    open() {
        try {
            if (this.isEnable) {
                this.core.context.logger.logError('Cannot open a closed HTTP server');
                return;
            }
            this.initializeServer();
            this.isEnable = true;
        } catch (e) {
            this.core.context.logger.logError(`[OneBot] [HTTP Server Adapter] Boot Error: ${e}`);
        }
    }

    async close() {
        this.isEnable = false;
        this.server?.close();
        this.app = undefined;
    }

    private initializeServer() {
        this.app = new Hono();
        this.app.use(cors());
        this.app.use(async (c, next) => this.authorize(this.config.token, c, next));
        this.app.use((c) => this.handleRequest(c));
        this.server = serve({
            fetch: this.app.fetch.bind(this.app),
            port: this.config.port,
        });
    }

    private authorize(token: string | undefined, c: Context, next: Next) {
        if (!token || token.length === 0) return next(); // 客户端未设置密钥
        const headerClientToken = c.req.header('authorization')?.split('Bearer ').pop() || '';
        const queryClientToken = c.req.query('access_token');
        const clientToken = typeof queryClientToken === 'string' && queryClientToken !== '' ? queryClientToken : headerClientToken;
        if (clientToken === token) {
            return next();
        }
        c.status(403);
        c.json({ message: 'token verify failed!' });
        return;
    }

    async httpApiRequest(c: Context) {
        try {
            // 处理根路径请求
            if (c.req.path === '' || c.req.path === '/') {
                const hello = OB11Response.ok({});
                hello.message = 'NapCat4 Is Running';
                return c.json(hello);
            }

            // 解析请求参数（合并查询参数和请求体）
            let payload: Record<string, any> = {};

            // 1. 获取URL查询参数
            const queryParams = c.req.query();
            if (Object.keys(queryParams).length > 0) {
                payload = { ...queryParams };
            }

            // 2. 尝试解析请求体，无论内容类型如何
            try {
                const contentType = c.req.header('content-type') || '';
                if (contentType.includes('application/json')) {
                    const jsonBody = await c.req.json();
                    payload = { ...payload, ...jsonBody };
                } else if (contentType) {
                    // 其他内容类型通过通用解析器处理
                    const body = await c.req.parseBody();
                    payload = { ...payload, ...body };
                }
            } catch (parseError) {
                // 解析失败时继续使用已有参数
            }

            // 处理API请求
            const actionName = c.req.path.split('/')[1];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const action = this.actions.get(actionName as any);
            if (action) {
                try {
                    const result = await action.handle(payload, this.name, this.config);
                    return c.json(result);
                } catch (error: unknown) {
                    return c.json(OB11Response.error((error as Error)?.stack?.toString() || (error as Error)?.message || 'Error Handle', 200));
                }
            } else {
                return c.json(OB11Response.error('不支持的Api ' + actionName, 200));
            }
        } catch (error: unknown) {
            return c.json(OB11Response.error('请求处理失败: ' + ((error as Error)?.message || 'Unknown error'), 200));
        }
    }

    async handleRequest(c: Context) {
        if (!this.isEnable) {
            this.core.context.logger.log('[OneBot] [HTTP Server Adapter] Server is closed');
            return c.json(OB11Response.error('Server is closed', 200));
        }
        return await this.httpApiRequest(c);  // 添加return关键字
    }

    async reload(newConfig: HttpServerConfig) {
        const wasEnabled = this.isEnable;
        const oldPort = this.config.port;
        this.config = newConfig;

        if (newConfig.enable && !wasEnabled) {
            this.open();
            return OB11NetworkReloadType.NetWorkOpen;
        } else if (!newConfig.enable && wasEnabled) {
            this.close();
            return OB11NetworkReloadType.NetWorkClose;
        }

        if (oldPort !== newConfig.port) {
            this.close();
            if (newConfig.enable) {
                this.open();
            }
            return OB11NetworkReloadType.NetWorkReload;
        }

        return OB11NetworkReloadType.Normal;
    }
}