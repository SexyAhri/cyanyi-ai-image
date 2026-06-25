import type { ApiMode, ApiProfile } from "../../types";
import { DEFAULT_SETTINGS } from "../api/apiProfiles";
import { sanitizeProviderErrorMessage } from "../api/providerErrors";

export const OPENAI_INTERRUPTED_ERROR = "请求中断";
export const AGENT_STOPPED_MESSAGE = "已停止生成。";

const TIMEOUT_STREAMING_HINT =
  "也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。";
const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT =
  "官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。";
const TIMEOUT_PARTIAL_IMAGES_LOW_HINT =
  "也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。";

export type TimeoutStreamingHintProfile = Pick<
  ApiProfile,
  "provider" | "streamImages" | "streamPartialImages"
>;

export type NetworkErrorHintProfile = Pick<
  ApiProfile,
  "provider" | "apiMode" | "streamImages" | "streamPartialImages"
>;

export { sanitizeProviderErrorMessage };

export function getTimeoutStreamingHint(
  profile?: TimeoutStreamingHintProfile | null,
) {
  if (profile?.provider !== "openai") return "";
  const partialImages =
    profile.streamPartialImages ?? DEFAULT_SETTINGS.streamPartialImages ?? 0;
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT;
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT;
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : "";
}

export function createOpenAITimeoutError(
  timeoutSeconds: number,
  profile?: TimeoutStreamingHintProfile | null,
) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。${getTimeoutStreamingHint(profile)}`;
}

export function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase();
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(
      message,
    );
  }
  return false;
}

export function shouldAutoRetryTaskError(err: unknown): boolean {
  if (err instanceof Error) {
    const message = err.message;
    if (
      message === OPENAI_INTERRUPTED_ERROR ||
      message.includes(AGENT_STOPPED_MESSAGE)
    ) {
      return false;
    }
  }
  return isApiRequestNetworkError(err);
}

export function shouldFallbackNonStreaming(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /流式|stream|event-stream|empty|空响应|空流|choices|null/i.test(
    message,
  );
}

export function getAutoRetryFinalError(retryCount: number) {
  return `网络连接中断，已自动重试 ${retryCount} 次仍失败。可以稍后再试，或降低尺寸/质量后重新生成。`;
}

export function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: NetworkErrorHintProfile | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null;

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000);

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return "提示：请求立即失败，请检查 API 代理服务是否正常运行。";
    }
    const unsupportedApiHint =
      profile?.provider === "openai"
        ? `\n· API 不支持 ${getApiModeApiName(profile.apiMode)}`
        : "";
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求，可检查接口 CORS 设置，或在本地开发时配置 API 代理解决`;
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return `提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`;
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return `提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}`;
  }

  return `提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`;
}

function getApiModeApiName(apiMode: ApiMode) {
  if (apiMode === "responses") return "Responses API";
  if (apiMode === "videos") return "Videos API";
  return "Image API";
}
