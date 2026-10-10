import {
  ChannelClient,
  MessagePortProtocol,
  ProxyChannel,
  type MessagePortLike,
  type MessagePortPayload,
} from "@ycode/rpc";
import {
  IYCodeTaskService,
  type IYCodeTaskService as IYCodeTaskServiceShape,
} from "#src/session/ycodeTaskService.js";
import {
  IYCodeAgentService,
  type IYCodeAgentService as IYCodeAgentServiceShape,
} from "#src/ycode-agent/ycodeAgent.js";
import {
  IYCodeSessionService,
  type IYCodeSessionService as IYCodeSessionServiceShape,
} from "#src/ycode-session/ycodeSession.js";
import {
  IModelSelectionService,
  type IModelSelectionService as IModelSelectionServiceShape,
} from "#src/model-provider/providerFacadeServices.js";

interface PortLike {
  on?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  off?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  addEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  removeEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  postMessage(message: MessagePortPayload): void;
  start?(): void;
  close?(): void;
}

function toMessagePortLike(port: PortLike): MessagePortLike {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(data) {
      port.postMessage(data);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

export interface RemoteBotWorkspaceRuntimeServices {
  ycodeAgentService: IYCodeAgentServiceShape;
  ycodeTaskService: IYCodeTaskServiceShape;
  ycodeSessionService: IYCodeSessionServiceShape;
  modelSelectionService: IModelSelectionServiceShape;
}

export function createRemoteRuntimeServicesFromPort(
  port: unknown,
): RemoteBotWorkspaceRuntimeServices {
  const protocol = new MessagePortProtocol(toMessagePortLike(port as PortLike));
  const client = new ChannelClient(protocol);
  return {
    ycodeAgentService: ProxyChannel.toService<IYCodeAgentServiceShape>(
      client.getChannel(IYCodeAgentService.channelName),
    ),
    ycodeTaskService: ProxyChannel.toService<IYCodeTaskServiceShape>(
      client.getChannel(IYCodeTaskService.channelName),
    ),
    ycodeSessionService: ProxyChannel.toService<IYCodeSessionServiceShape>(
      client.getChannel(IYCodeSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionServiceShape>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}
