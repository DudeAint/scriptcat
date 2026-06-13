import LoggerCore, { EmptyWriter } from "@App/app/logger/core";
import { MockMessage } from "@Packages/message/mock_message";
import type { IGetSender } from "@Packages/message/server";
import { Server } from "@Packages/message/server";
import type { Message } from "@Packages/message/types";
import { ValueService } from "@App/app/service/service_worker/value";
import GMApi, { MockGMExternalDependencies } from "@App/app/service/service_worker/gm_api/gm_api";
import OffscreenGMApi from "@App/app/service/offscreen/gm_api";
import EventEmitter from "eventemitter3";
import "@Packages/chrome-extension-mock";
import { MessageQueue } from "@Packages/message/message_queue";
import { SystemConfig } from "@App/pkg/config/config";
import type { ApiValue, ConfirmParam, UserConfirm } from "@App/app/service/service_worker/permission_verify";
import PermissionVerify from "@App/app/service/service_worker/permission_verify";
import type { GMApiRequest } from "@App/app/service/service_worker/types";

export function initTestEnv() {
  // @ts-ignore
  if (global.initTest) {
    return;
  }
  // @ts-ignore
  global.initTest = true;

  const logger = new LoggerCore({
    level: "trace",
    consoleLevel: "trace",
    writer: new EmptyWriter(),
    labels: { env: "test" },
  });
  logger.logger().debug("test start");
}

const noConfirmScripts = new Set<string>();
export const addTestPermission = (uuid: string) => {
  noConfirmScripts.add(uuid);
};

export function initTestGMApi(opts?: {
  realVerify?: boolean;
  onConfirm?: (confirm: ConfirmParam) => UserConfirm;
}): Message {
  const wsEE = new EventEmitter<string, any>();
  const wsMessage = new MockMessage(wsEE);
  const osEE = new EventEmitter<string, any>();
  const osMessage = new MockMessage(osEE);
  const messageQueue = new MessageQueue();
  const systemConfig = new SystemConfig(messageQueue);

  const serviceWorkerServer = new Server("serviceWorker", wsMessage);
  const valueService = new ValueService(serviceWorkerServer.group("value"), messageQueue);
  const permissionVerify = new PermissionVerify(serviceWorkerServer.group("permissionVerify"), messageQueue);
  if (opts?.realVerify) {
    // 走真实的权限验证逻辑（@connect 白名单 / 网络黑名单 / 站点访问）。
    // onConfirm 模拟用户在确认弹窗中的选择；未提供时走到弹窗即抛出，避免测试挂起。
    const onConfirm = opts.onConfirm;
    permissionVerify.confirmWindow = async (_script, confirm) => {
      if (onConfirm) return onConfirm(confirm);
      throw new Error("unexpected confirm window in test");
    };
    permissionVerify.init();
  } else {
    (permissionVerify as any).confirmWindowActual = permissionVerify.confirmWindow;
    (permissionVerify as any).verify = function <T>(request: GMApiRequest<T>, _api: ApiValue, _sender: IGetSender) {
      if (noConfirmScripts.has(request.uuid)) return true;
      return false;
    };
  }
  const swGMApi = new GMApi(
    systemConfig,
    permissionVerify,
    serviceWorkerServer.group("runtime"),
    osMessage,
    messageQueue,
    valueService,
    new MockGMExternalDependencies()
  );

  swGMApi.start();

  // offscreen
  const offscreenServer = new Server("offscreen", osMessage);
  const osGMApi = new OffscreenGMApi(offscreenServer.group("gmApi"));
  osGMApi.init();

  return wsMessage;
}
