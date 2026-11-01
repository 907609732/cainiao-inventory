import {
  enabledNotificationChannels,
  validateNotifications,
} from "../desktop/shared/notification-settings.mjs";
import { sendNotificationReport } from "./notifications.js";
// Existing monthly_report_deliveries primary key is reused with one report type
// per added channel. The historical DingTalk key stays intact.
export async function sendMonthlyNotifications({
  db,
  reportType,
  month,
  report,
  settings,
  secrets,
  providers,
}) {
  const check = validateNotifications(
    settings,
    Object.fromEntries(
      Object.entries(secrets).map(([k, v]) => [k, Boolean(v)]),
    ),
    { requireEnabled: true },
  );
  if (!check.ok) throw Error(check.errors.join("；"));
  const channels = {};
  for (const id of enabledNotificationChannels(settings)) {
    const type = id === "dingtalk" ? reportType : reportType + ":" + id;
    const old = db
      .prepare(
        "SELECT status FROM monthly_report_deliveries WHERE report_type=? AND report_month=?",
      )
      .get(type, month);
    if (old && ["sent", "pending", "unknown"].includes(old.status)) {
      channels[id] = {
        status: old.status === "sent" ? "accepted" : "unknown",
        deduplicated: true,
      };
      continue;
    }
    const claim =
      old?.status === "failed"
        ? db
            .prepare(
              "UPDATE monthly_report_deliveries SET status='pending',attempted_at=CURRENT_TIMESTAMP,error_text='',result_json='{}' WHERE report_type=? AND report_month=? AND status='failed'",
            )
            .run(type, month)
        : db
            .prepare(
              "INSERT OR IGNORE INTO monthly_report_deliveries(report_type,report_month,status,attempted_at,sent_at,error_text,result_json,updated_at) VALUES(?,?,'pending',CURRENT_TIMESTAMP,'','','{}',CURRENT_TIMESTAMP)",
            )
            .run(type, month);
    if (claim.changes !== 1) {
      channels[id] = { status: "unknown", deduplicated: true };
      continue;
    }
    try {
      const result = await sendNotificationReport({
        title: report.title,
        text: report.text,
        settings,
        secrets,
        providers,
        onlyChannels: [id],
      });
      const row = result.channels[id],
        status = row.status === "accepted" ? "sent" : row.status;
      db.prepare(
        "UPDATE monthly_report_deliveries SET status=?,sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE '' END,result_json=?,error_text=?,updated_at=CURRENT_TIMESTAMP WHERE report_type=? AND report_month=?",
      ).run(
        status,
        status,
        JSON.stringify(row),
        row.status === "accepted" ? "" : "渠道发送未完成",
        type,
        month,
      );
      channels[id] = row;
    } catch {
      db.prepare(
        "UPDATE monthly_report_deliveries SET status='unknown',error_text='渠道发送结果不明',updated_at=CURRENT_TIMESTAMP WHERE report_type=? AND report_month=?",
      ).run(type, month);
      channels[id] = { status: "unknown" };
    }
  }
  const sent =
    Object.keys(channels).length > 0 &&
    Object.values(channels).every((r) => r.status === "accepted");
  if (!sent)
    throw Object.assign(
      Error(
        "月报未全部受理，请检查各渠道记录；已受理或结果不明的渠道不会自动重发",
      ),
      { deliveryStatus: "unknown", channels },
    );
  return { sent: true, channels, report };
}
