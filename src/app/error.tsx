"use client";

import { useEffect } from "react";

/**
 * 路由级错误边界。
 *
 * ## 为什么必须有这个文件
 *
 * 没有它时，任何一个在**渲染期**抛出的异常都会让 React 卸载整棵组件树 ——
 * 页面上什么都不剩（只有 layout.tsx 那条内联看门狗会浮出来说"资源未加载"，
 * 而那个提示其实指错了方向：资源是好的，是渲染炸了）。用户看到的就是
 * **整站白屏 + 一条让人去查网络的告警**，且刷新也无法自愈（同一份数据会再次触发）。
 *
 * 有了它，异常被就地接住：界面退化成一张说明卡片，用户至少能重试、
 * 能重新加载，而不是面对一片空白。
 *
 * ⚠️ 这是**兜底**，不是**借口**。真正的防线在数据入口的归一化
 * （`offline-store.normalizeTask` / `rowToTask` / `normalizeTask` 的枚举与数组补齐）
 * 与渲染层的默认值上 —— 那些才是让页面根本不会走到这里的原因。
 * 边界只负责一件事：万一还是炸了，别把整个应用一起带走。
 *
 * 视觉：沿用全站亮色（底 `#F8FAFC`、白卡 + `#E2E8F0` 边框），不使用暗色硬编码。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 完整堆栈打到控制台，便于线上用 devtools 直接抓。
    // 看门狗那条提示会让人误以为是网络问题，这里必须留下真实原因。
    console.error("[FlowMirror] 渲染期异常，已由错误边界接住：", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-10 sm:px-6">
      <section
        data-app-error
        role="alert"
        className="rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-sm"
      >
        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">FlowMirror</p>
        <h1 className="mt-2 text-lg font-medium tracking-tight text-[#0F172A]">
          这个板块刚才没能渲染出来
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[#475569]">
          你的任务与复盘记录都还在本地 / 云端，没有丢失。这通常是某一条历史记录
          缺少字段导致的显示异常，可以先用下方按钮恢复：
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-app-error-reset
            onClick={reset}
            className="rounded-xl bg-[#0D9488] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            重试渲染
          </button>
          <button
            type="button"
            data-app-error-reload
            onClick={() => window.location.reload()}
            className="rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-medium text-[#334155] transition-colors hover:bg-[#F1F5F9]"
          >
            重新加载页面
          </button>
        </div>

        {error?.message && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-[#64748B]">技术细节</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[10px] leading-relaxed text-[#475569]">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>
        )}
      </section>
    </main>
  );
}
