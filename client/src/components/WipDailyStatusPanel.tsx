import { trpc } from "@/lib/trpc";
import { CheckCircle2, Clock, AlertCircle, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** 格式化接收时间：仅显示 HH:mm:ss，null 或空值返回空串 */
function fmtTime(val: unknown): string {
  if (val == null || val === "") return "";
  // superjson 可能将 DATETIME 反序列化为 Date 对象
  if (val instanceof Date) {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}`;
  }
  const s = String(val);
  // 可能是 "2026-08-11 14:32:05" 或 "14:32:05" 格式
  const timePart = s.includes(" ") ? s.split(" ")[1] : s;
  return timePart ? timePart.slice(0, 8) : "";
}

export default function WipDailyStatusPanel() {
  const { data, isLoading, isError } = trpc.wipDailyStatus.list.useQuery({}, {
    refetchInterval: 60_000,
  });

  const vendors = data?.vendors ?? [];
  const { received, total } = data?.summary ?? { received: 0, total: 0 };

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${WEEKDAYS[now.getDay()]}`;

  const summaryColor =
    total === 0 ? "text-muted-foreground"
    : received === total ? "text-green-600"
    : received > 0 ? "text-amber-600"
    : "text-red-500";

  return (
    <Card className="border-border/60 shadow-sm py-2 gap-2 flex-shrink-0 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02]">
      <CardContent className="px-4 py-2 space-y-3">
        {/* 标题行 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-primary" />
            <span className="text-sm font-semibold">今日WIP日报接收状态</span>
            <span className="text-xs text-muted-foreground">{dateStr}</span>
          </div>
          <div className="flex items-center gap-3">
            {total > 0 && (
              <span className={`text-xs font-medium ${summaryColor}`}>
                已接收 {received}/{total} 家
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] text-green-700">
              <CheckCircle2 size={18} /> 已接收
            </span>
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <Clock size={18} /> 未接收
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-[7.25rem] rounded-md flex-shrink-0" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive py-2">
            <AlertCircle size={16} />
            <span>查询 WIP 日报接收状态失败，请稍后重试</span>
          </div>
        ) : vendors.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            暂无供应商数据
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vendors.map((v) => {
              const isReceived = v.status === 1;
              return (
                <div
                  key={v.vendor_code}
                  className={`flex items-center justify-between rounded-md border px-2 py-1.5 w-[7.25rem] flex-shrink-0 ${
                    isReceived
                      ? "border-green-200 bg-green-50/50"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium truncate" title={v.vendor_name}>
                      {v.vendor_name}
                    </span>
                    {isReceived && v.receive_time ? (
                      <span className="text-[10px] text-muted-foreground leading-tight">
                        {fmtTime(v.receive_time)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-600 leading-tight">未接收</span>
                    )}
                  </div>
                  {isReceived ? (
                    <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 ml-1" />
                  ) : (
                    <Clock size={18} className="text-amber-500 flex-shrink-0 ml-1" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
