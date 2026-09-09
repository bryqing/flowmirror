import { FlowProvider } from "@/components/flow-context";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/layout/command-bar";
import { YesterdayMirror } from "@/components/mirror/yesterday-mirror";
import { TodayFlow } from "@/components/today/today-flow";
import { TimeHeatmap } from "@/components/heatmap/time-heatmap";
import { TaskDetailDrawer } from "@/components/today/task-detail-drawer";
import { ReviewDrawer } from "@/components/review/review-drawer";

export default function Home() {
  return (
    <FlowProvider>
      <AppShell>
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-24 pt-5 sm:gap-10 sm:px-6">
          {/* 第一层（最顶）：昨日之镜 —— 晨间第一眼先看见昨天的反思与教训 */}
          <YesterdayMirror />

          {/* 第二层（居中核心主战场）：今日战局
              顶部自然语言调度吸附条 + 日期胶囊条 → 晨间金句 → 2x2 四象限大盘 */}
          <TodayFlow />

          {/* 第三层（最底）：今日时间分布 · 24小时黑洞热力大盘 */}
          <TimeHeatmap />
        </main>

        {/* 抽屉层：任务详情 / 微复盘 */}
        <TaskDetailDrawer />
        <ReviewDrawer />

        <Toaster />
      </AppShell>
    </FlowProvider>
  );
}
