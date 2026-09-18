import { FlowProvider } from "@/components/flow-context";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/layout/command-bar";
import { Dashboard } from "@/components/layout/dashboard";
import { TaskDetailDrawer } from "@/components/today/task-detail-drawer";
import { ReviewDrawer } from "@/components/review/review-drawer";

export default function Home() {
  return (
    <FlowProvider>
      <AppShell>
        {/* 看板主体：晨间心锚 + 五大板块导航 + 单页切换 */}
        <Dashboard />

        {/* 抽屉层：任务详情 / 微复盘 */}
        <TaskDetailDrawer />
        <ReviewDrawer />

        <Toaster />
      </AppShell>
    </FlowProvider>
  );
}
