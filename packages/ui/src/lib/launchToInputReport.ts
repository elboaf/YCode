import type { LaunchMarks } from "@ycode/shared";

export function shouldReportLaunchToInput(state: {
  isStartupRenderBlocked: boolean;
  welcomeScreenOpen: boolean;
  alreadyReported: boolean;
}): boolean {
  // 门禁清除 = RootStartupLoading 退场、输入框挂载;welcome 时虽门禁清除但显示登录页、无输入框,不算"能输入"。
  return !state.alreadyReported && !state.isStartupRenderBlocked && !state.welcomeScreenOpen;
}

export function readRendererLaunchTimings(): {
  marks: LaunchMarks | null;
  rendererStart: number;
  reactCommit: number;
} | null {
  const w = window as Window & {
    __YCODE_LAUNCH_MARKS__?: LaunchMarks | null;
    __YCODE_RENDERER_START__?: number;
    __YCODE_REACT_COMMIT_AT__?: number;
  };
  const rendererStart = w.__YCODE_RENDERER_START__;
  const reactCommit = w.__YCODE_REACT_COMMIT_AT__;
  if (typeof rendererStart !== "number" || typeof reactCommit !== "number") {
    return null;
  }
  return { marks: w.__YCODE_LAUNCH_MARKS__ ?? null, rendererStart, reactCommit };
}
