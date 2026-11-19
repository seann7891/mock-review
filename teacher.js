// 教師後台：全班錯題分布、錯因統計、個別學生的對話與學習計劃。
(() => {
  const API = window.API_BASE;
  const app = document.getElementById("app");
  const SUBJECT_CLASS = { 物理: "phy", 化學: "chem", 生物: "bio", 地球科學: "earth" };
  const STATUS = { pass: "✓ 通過", partial: "△ 部分", fail: "✕ 未通過", untested: "－ 未檢核" };
  let pw = sessionStorage.getItem("mr.teacher") || "";
  let exam = null;
  let data = null;

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  async function api(path) {
    let res;
    try {
      res = await fetch(API + path, { cache: "no-store", headers: { Authorization: `Bearer ${pw}` } });
    } catch {
      throw new Error("連不上伺服器。");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `發生錯誤（${res.status}）`);
    return body;
  }

  const tag = (s) => h("span", { class: `tag ${SUBJECT_CLASS[s] || ""}` }, s === "地球科學" ? "地科" : s);
  const causeLabel = (c) => data.causes[c]?.label || c;

  function bars(rows, max, bad) {
    return h("div", { class: "bars" }, rows.map(([label, val, text]) =>
      h("div", { class: "bar" }, h("span", {}, label),
        h("div", { class: "track" }, h("div", { class: `fill ${bad ? "bad" : ""}`, style: `width:${max ? Math.round((val / max) * 100) : 0}%` })),
        h("span", { class: "val" }, text ?? val))));
  }

  function viewLogin(msg = "") {
    document.getElementById("logout").hidden = true;
    const input = h("input", { type: "password", id: "pw", autocomplete: "off", required: true });
    const err = h("div", { class: "error", role: "alert" }, msg);
    app.replaceChildren(h("form", {
      class: "card", style: "max-width:420px;margin:40px auto",
      onsubmit: (e) => { e.preventDefault(); pw = input.value; sessionStorage.setItem("mr.teacher", pw); load(); },
    }, h("label", { for: "pw" }, "教師密碼"), input, err, h("div", { class: "row" }, h("span", { class: "spacer" }), h("button", { class: "primary", type: "submit" }, "進入後台"))));
  }

  async function load() {
    app.replaceChildren(h("p", { class: "muted" }, "載入中…"));
    try {
      data = await api(`/api/teacher/overview${exam ? `?exam=${exam}` : ""}`);
      exam = data.exam;
    } catch (ex) {
      pw = "";
      sessionStorage.removeItem("mr.teacher");
      return viewLogin(ex.message);
    }
    document.getElementById("logout").hidden = false;
    const hash = location.hash.slice(1);
    hash.startsWith("s/") ? viewStudent(decodeURIComponent(hash.slice(2))) : viewOverview();
  }

  function downloadCsv() {
    const qn = Object.fromEntries(data.questions.map((q) => [q.id, q.number]));
    const codes = Object.keys(data.causes);
    const rows = [["班級", "座號", "姓名", "錯題數", "已診斷", "錯題題號", ...codes.map(causeLabel), "已產生計劃"]];
    for (const s of data.students)
      rows.push([s.cls, s.seat, s.name, s.wrong.length, s.diagnosed, s.wrong.map((id) => qn[id]).sort((a, b) => a - b).join(" "), ...codes.map((c) => s.causeCounts[c] || 0), s.hasPlan ? "是" : "否"]);
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `模擬考第${exam}次_錯題診斷.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function viewOverview() {
    const n = data.students.length;
    const tabs = h("div", { class: "tabs" }, data.exams.map((e) => h("button", { "aria-selected": String(e === exam), onclick: () => { exam = e; load(); } }, `第 ${e} 次模擬考`)));

    const causeRows = Object.entries(data.causeCounts).sort((a, b) => b[1] - a[1]).map(([c, v]) => [causeLabel(c), v, `${v} 題次`]);

    const qRows = data.questions.map((q) => ({ q, wrong: data.wrongCount[q.id] || 0, causes: data.causeByQuestion[q.id] || {} })).filter((r) => r.wrong).sort((a, b) => b.wrong - a.wrong);
    const qTable = h("div", { class: "scroll-x" }, h("table", {},
      h("thead", {}, h("tr", {}, ["題號", "科目", "主題", "答案", "錯的人數", "主要錯因（已診斷者）"].map((t) => h("th", {}, t)))),
      h("tbody", {}, qRows.map(({ q, wrong, causes }) => h("tr", {},
        h("td", {}, q.number), h("td", {}, tag(q.subject)), h("td", {}, q.topic),
        h("td", {}, q.type === "open" ? "非選" : q.answer.join("")),
        h("td", {}, `${wrong}${n ? `（${Math.round((wrong / n) * 100)}%）` : ""}`),
        h("td", {}, Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${causeLabel(c)}×${v}`).join("、") || "—"))))));

    const chapters = {};
    for (const { q, wrong } of qRows) chapters[`${q.subject}｜${q.chapter}`] = (chapters[`${q.subject}｜${q.chapter}`] || 0) + wrong;
    const chRows = Object.entries(chapters).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, v, `${v} 人次`]);

    const sTable = h("div", { class: "scroll-x" }, h("table", {},
      h("thead", {}, h("tr", {}, ["班級", "座號", "姓名", "錯題", "已診斷", "最主要的錯因", "計劃"].map((t) => h("th", {}, t)))),
      h("tbody", {}, data.students.map((s) => h("tr", { class: "click", tabindex: 0, onclick: () => (location.hash = `#s/${s.id}`), onkeydown: (e) => { if (e.key === "Enter") location.hash = `#s/${s.id}`; } },
        h("td", {}, s.cls), h("td", {}, s.seat), h("td", {}, s.name), h("td", {}, s.wrong.length), h("td", {}, s.diagnosed),
        h("td", {}, Object.entries(s.causeCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, v]) => `${causeLabel(c)}×${v}`).join("、") || "—"),
        h("td", {}, s.hasPlan ? "✓" : ""))))));

    app.replaceChildren(
      tabs,
      h("div", { class: "row" }, h("p", { class: "muted" }, `已有 ${n} 位學生填寫錯題。`), h("span", { class: "spacer" }), h("button", { class: "small", onclick: load }, "重新整理"), h("button", { class: "small", onclick: downloadCsv }, "下載 CSV")),
      h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "全班錯因分布"),
        h("p", { class: "muted" }, "「題次」＝該錯因在所有已診斷的錯題中被判定出現的次數。"),
        causeRows.length ? bars(causeRows, Math.max(...causeRows.map((r) => r[1])), true) : h("p", { class: "muted" }, "尚無已完成的診斷。")),
      h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "錯最多的章節"), chRows.length ? bars(chRows, Math.max(...chRows.map((r) => r[1]))) : h("p", { class: "muted" }, "尚無資料。")),
      h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "各題錯誤人數"), qRows.length ? qTable : h("p", { class: "muted" }, "尚無資料。")),
      h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "學生列表（點一列看詳細）"), n ? sTable : h("p", { class: "muted" }, "尚無資料。")));
  }

  async function viewStudent(id) {
    app.replaceChildren(h("p", { class: "muted" }, "載入中…"));
    let d;
    try {
      d = await api(`/api/teacher/student?id=${encodeURIComponent(id)}&exam=${exam}`);
    } catch (ex) {
      return void app.replaceChildren(h("p", { class: "error" }, ex.message));
    }
    const qmap = Object.fromEntries(data.questions.map((q) => [q.id, q]));
    const skillRows = d.skillMap.filter((s) => s.level != null).sort((a, b) => a.level - b.level).map((s) => [s.label, s.level, `${s.level}/5`]);
    const attempts = d.attempts.sort((a, b) => qmap[a.qid].number - qmap[b.qid].number);
    const undiagnosed = d.wrong.filter((qid) => !attempts.some((a) => a.qid === qid)).map((qid) => qmap[qid].number).sort((a, b) => a - b);
    const p = d.plan;

    app.replaceChildren(
      h("div", { class: "row no-print" }, h("button", { class: "small ghost", onclick: () => (location.hash = "") }, "← 回總覽"), h("span", { class: "spacer" }), h("button", { class: "small", onclick: () => window.print() }, "列印")),
      h("h2", {}, `${d.student.cls} 班 ${d.student.seat} 號 ${d.student.name}｜第 ${exam} 次模擬考`),
      h("p", { class: "muted" }, `錯題 ${d.wrong.length} 題；尚未診斷：${undiagnosed.join("、") || "無"}`),
      h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "能力向度（依錯題中的步驟表現，0–5 級）"), skillRows.length ? bars(skillRows, 5) : h("p", { class: "muted" }, "資料不足。")),
      p ? h("div", { class: "card plan" }, h("h3", { style: "margin-top:0" }, "AI 產生的學習計劃"), h("p", {}, p.overview),
            h("ol", {}, p.weaknesses.map((w) => h("li", {}, h("strong", {}, w.title), `（${w.kind}・${causeLabel(w.cause)}）`, h("br"), h("span", { class: "muted" }, w.evidence), h("br"), w.fix))),
            p.weeks.map((w) => h("div", { class: "week" }, h("strong", {}, `第 ${w.week} 週：${w.focus}`), h("ul", {}, w.tasks.map((t) => h("li", {}, t))), h("p", { class: "muted" }, `檢核：${w.check}`))))
        : "",
      h("h3", {}, "逐題診斷紀錄"),
      ...attempts.map((a) => {
        const q = qmap[a.qid];
        return h("details", { class: "card" },
          h("summary", {}, h("strong", {}, `第 ${q.number} 題 `), tag(q.subject), ` ${q.topic}　`,
            a.done ? h("span", { class: "tag ok" }, "已完成") : h("span", { class: "tag warn" }, "進行中"), " ",
            [...new Set(a.causes.map((c) => c.code))].map((c) => h("span", { class: "tag bad", style: "margin-right:4px" }, causeLabel(c)))),
          h("p", { class: "muted" }, `學生作答：${a.chosen || "—"}｜正確答案：${q.type === "open" ? "（非選）" : q.answer.join("")}｜對話 ${a.turns} 輪`),
          a.summary ? h("p", {}, h("strong", {}, "診斷："), a.summary) : null,
          h("p", { class: "muted" }, a.steps.map((s) => `步驟${s.n} ${STATUS[s.status]}`).join("　")),
          a.causes.length ? h("ul", {}, a.causes.map((c) => h("li", {}, h("strong", {}, causeLabel(c.code)), `：${c.evidence}`))) : null,
          h("div", { class: "chat" }, a.transcript.map((m) => h("div", { class: `msg ${m.role}` }, m.text))));
      }));
  }

  document.getElementById("logout").onclick = () => { pw = ""; sessionStorage.removeItem("mr.teacher"); viewLogin(); };
  window.addEventListener("hashchange", () => (data ? (location.hash.startsWith("#s/") ? viewStudent(decodeURIComponent(location.hash.slice(3))) : viewOverview()) : null));
  pw ? load() : viewLogin();
})();
