"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker
 * - 仅在浏览器 + 生产环境 + 安全上下文（HTTPS / localhost）下生效
 * - 开发模式不注册，并**主动清理历史遗留的 SW 与缓存**（见下方说明）
 * - 监听 controllerchange：新 SW 接管时自动 reload，确保版本一致
 *
 * ⚠️ 为什么开发环境必须「清理」而不只是「不注册」：
 * 同一 origin 上如果曾经跑过生产构建（尤其是通过 HTTPS 隧道访问的手机端），SW 会长期驻留。
 * 之后 dev 服务复用同一 origin 时，旧 SW 会继续拦截导航：网络请求失败就回退到它缓存的
 * 旧构建 HTML，而该 HTML 引用的 hash 包在新构建里已不存在 → 全部 404。
 * 结果就是「页面文字正常显示，但 React 完全没接管，所有点击都无响应」的僵尸页。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // 开发环境：不注册新 SW，并清理任何残留的 SW + Cache Storage，避免僵尸页
    if (process.env.NODE_ENV !== "production") {
      const PURGE_FLAG = "fm:dev-sw-purged";
      void (async () => {
        try {
          let purged = false;

          const regs = await navigator.serviceWorker.getRegistrations();
          if (regs.length > 0) {
            await Promise.all(regs.map((r) => r.unregister()));
            purged = true;
            console.info(`[FlowMirror] 已卸载 ${regs.length} 个开发环境残留 Service Worker`);
          }

          if (window.caches) {
            const keys = await caches.keys();
            if (keys.length > 0) {
              await Promise.all(keys.map((k) => caches.delete(k)));
              purged = true;
              console.info(`[FlowMirror] 已清空 ${keys.length} 个残留缓存库`);
            }
          }

          // 当前页面可能仍被旧 SW 控制（unregister 对已加载的文档不立即生效），
          // 需重载一次彻底脱离控制器。用 sessionStorage 标记防止无限刷新。
          if (purged && !sessionStorage.getItem(PURGE_FLAG)) {
            sessionStorage.setItem(PURGE_FLAG, "1");
            console.info("[FlowMirror] 正在重新加载以脱离旧 Service Worker…");
            window.location.reload();
          }
        } catch (err) {
          console.warn("[FlowMirror] 开发环境 SW 清理失败：", err);
        }
      })();
      return;
    }

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
