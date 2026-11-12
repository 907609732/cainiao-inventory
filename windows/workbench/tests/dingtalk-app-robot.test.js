import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDingTalkApiError,
  buildDingTalkAppRobotGroupPayload
} from "../core/dingtalk-app-robot.js";

test("enterprise robot group payload only includes fields accepted by the DingTalk group API", () => {
  const payload = buildDingTalkAppRobotGroupPayload({
    robotCode: " robot-code ",
    conversationId: " cid-group ",
    msgKey: " sampleMarkdown ",
    msgParam: { title: "库存日报", text: "库存正文" },
    userIds: ["user-1"]
  });

  assert.deepEqual(payload, {
    robotCode: "robot-code",
    openConversationId: "cid-group",
    msgKey: "sampleMarkdown",
    msgParam: JSON.stringify({ title: "库存日报", text: "库存正文" })
  });
  assert.equal("userIds" in payload, false);
});

test("DingTalk API errors keep actionable codes while redacting sensitive values", () => {
  const error = buildDingTalkApiError({
    response: {
      status: 400,
      data: {
        code: "invalidParameter.robotCode.auth",
        message: "clientSecret=very-secret appKey mismatch",
        requestId: "request-123"
      }
    }
  }, "发送群消息");

  assert.match(error.message, /HTTP 400/);
  assert.match(error.message, /invalidParameter\.robotCode\.auth/);
  assert.match(error.message, /Request ID request-123/);
  assert.doesNotMatch(error.message, /very-secret/);
});


test("both DingTalk transports use compact SKU and quantity text without losing digits", async () => {
  const {buildDingTalkMarkdownPayload}=await import('../core/dingtalk.js');
  const text='| 货品名称 | SKU | 库存/销量 | 天数 | 预警 |\n|---|---|---|---:|---|\n| 演示商品完整名称<br>剩余规格 | DEMO-LONG-SKU-123456789 | 123456789/987654321 | 12345 | 🔴 不够卖 1 周 |';
  const webhook=buildDingTalkMarkdownPayload({title:'虚构报告',text}).markdown.text;
  const app=JSON.parse(buildDingTalkAppRobotGroupPayload({robotCode:'demo',conversationId:'demo',msgKey:'sampleMarkdown',msgParam:{title:'虚构报告',text}}).msgParam).text;
  assert.equal(app,webhook);
  assert.equal(buildDingTalkMarkdownPayload({title:'again',text:app}).markdown.text,app);
  assert.ok(app.includes('<font size="2">DEMO-LONG-SKU-123456789</font>'));
  assert.ok(app.includes('<font size="2">123456789/987654321</font>'));
  assert.ok(app.includes('| 12345 | 🔴 不够卖 1 周 |'));
  assert.ok(app.includes('演示商品完整名称<br>剩余规格'));
  assert.equal(buildDingTalkMarkdownPayload({title:'other',text:'unchanged'}).markdown.text,'unchanged');
});
