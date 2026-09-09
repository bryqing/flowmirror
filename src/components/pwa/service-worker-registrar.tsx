"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker
 * - 仅在浏览器 + 生产环境 + 安全上下文（HTTPS / localhost）下生效
 * - 开发模式不注册，避免缓存干扰 HMR
 * - 监听 controllerchange：新 SW 接管时自动 reload，确保版本一致
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    if (!window.isSecureContext) return;

    const onUpdate = (registration: ServiceWorkerRegistration) => {
      const waiting = registration.waiting;
      if (!waiting) return;
      // 监听新 SW 状态变化：进入 activated 时通知它跳过等待
      waiting.addEventListener("statechange", () => {
        if (waiting.state === "activated") {
          window.location.reload();
        }
      });
      // 主动告诉它 skip waiting
      waiting.postMessage({ type: "SKIP_WAITING" });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        // 若已有 waiting 状态的新 SW，立即处理
        if (reg.waiting) onUpdate(reg);
        // 检测到新 SW 安装中
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              console.info("[FlowMirror] 新版本已就绪，将自动刷新");
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[FlowMirror] SW 注册失败：", err);
      });

    // 监听 controller 变化（被新 SW 接管）
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }, []);

  return null;
}
