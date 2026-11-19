// 學生端。所有題目、詳解與 AI 都在後端；這裡只負責畫面。
(() => {
  const API = window.API_BASE;
  const app = document.getElementById("app");
  const SUBJECT_CLASS = { 物理: "phy", 化學: "chem", 生物: "bio", 地球科學: "earth" };
  const STATUS_MARK = { pass: "✓", partial: "△", fail: "✕", untested: "" };
  const STATUS_LABEL = { pass: "通過", partial: "部分通過", fail: "未通過", untested: "未檢核" };

  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };

  const S = {
    session: store.get("mr.session"), // { token, student, exams, causes, situations }
    exam: store.get("mr.exam"),
    questions: {}, // exam -> [question]
    state: null, // 目前考次的錯題清單、診斷紀錄、計劃
  };

  // ---------- 工具 ----------
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  async function api(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: { "Content-Type": "application/json", ...(S.session ? { Authorization: `Bearer ${S.session.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("連不上伺服器，請檢查網路後再試。");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.session) {
      logout();
      throw new Error(data.error || "請重新登入");
    }
    if (!res.ok) throw new Error(data.error || `發生錯誤（${res.status}）`);
    return data;
  }

  function logout() {
    store.del("mr.session");
    S.session = null;
    S.state = null;
    location.hash = "";
    render();
  }

  const subjectTag = (s) => h("span", { class: `tag ${SUBJECT_CLASS[s] || ""}` }, s === "地球科學" ? "地科" : s);
  const qById = (id) => (S.questions[S.exam] || []).find((q) => q.id === id);
  const attemptOf = (id) => S.state?.attempts.find((a) => a.qid === id);

  async function loadExam(exam) {
    S.exam = exam;
    store.set("mr.exam", exam);
    const [qs, st] = await Promise.all([
      S.questions[exam] ? { questions: S.questions[exam] } : api(`/api/questions?exam=${exam}`),
      api(`/api/state?exam=${exam}`),
    ]);
    S.questions[exam] = qs.questions;
    S.state = st;
  }

  function busy(btn, text) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = text;
    return () => { btn.disabled = false; btn.textContent = old; };
  }

  // ---------- 登入 ----------
  function viewLogin() {
    const err = h("div", { class: "error", role: "alert" });
    const f = {
      passcode: h("input", { id: "passcode", type: "password", autocomplete: "off", required: true }),
      cls: h("input", { id: "cls", inputmode: "numeric", placeholder: "例如 301", required: true }),
      seat: h("input", { id: "seat", type: "number", min: 1, max: 99, required: true }),
      name: h("input", { id: "name", maxlength: 20, placeholder: "可用暱稱", required: true }),
    };
    const btn = h("button", { class: "primary", type: "submit" }, "開始檢討");
    const form = h(
      "form",
      {
        class: "card",
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = "";
          const done = busy(btn, "登入中…");
          try {
            const data = await api("/api/login", {
              method: "POST",
              body: { passcode: f.passcode.value, cls: f.cls.value.trim(), seat: Number(f.seat.value), name: f.name.value.trim() },
            });
            S.session = data;
            store.set("mr.session", data);
            S.exam = S.exam && data.exams.includes(S.exam) ? S.exam : data.exams[0];
            render();
          } catch (ex) {
            err.textContent = ex.message;
            done();
          }
        },
      },
      h("label", { for: "passcode" }, "班級通行碼（老師提供）"), f.passcode,
      h("div", { class: "row" },
        h("div", { style: "flex:1;min-width:120px" }, h("label", { for: "cls" }, "班級"), f.cls),
        h("div", { style: "flex:1;min-width:90px" }, h("label", { for: "seat" }, "座號"), f.seat)),
      h("label", { for: "name" }, "姓名或暱稱"), f.name,
      err,
      h("div", { class: "row" }, h("span", { class: "spacer" }), btn)
    );
    app.replaceChildren(
      h("h2", {}, "自然科模擬考 錯題診斷"),
      h("p", {}, "填入你錯的題號，AI 家教會一題一題追問你，幫你找出真正卡住的地方：是觀念不清楚、數學工具不熟，還是沒把題目的關鍵字讀成解題線索。最後會給你一份補救計劃。"),
      h("p", { class: "muted" }, "請準備好你的試卷。這裡不會直接告訴你答案，你要自己說出想法。"),
      form
    );
  }

  // ---------- 首頁：選錯題 ----------
  async function viewHome() {
    app.replaceChildren(h("p", { class: "muted" }, "載入中…"));
    try {
      await loadExam(S.exam || S.session.exams[0]);
    } catch (ex) {
      app.replaceChildren(h("p", { class: "error" }, ex.message));
      return;
    }
    const qs = S.questions[S.exam];
    const selected = new Set(S.state.wrong);
    let dirty = false;

    const tabs = h("div", { class: "tabs", role: "tablist" },
      S.session.exams.map((e) =>
        h("button", { role: "tab", "aria-selected": String(e === S.exam), onclick: async () => { S.exam = e; await viewHome(); } }, `第 ${e} 次模擬考`)));

    const saveBtn = h("button", { class: "primary" }, "儲存錯題");
    const count = h("span", { class: "muted" });
    const refreshCount = () => {
      count.textContent = `已選 ${selected.size} 題${dirty ? "（尚未儲存）" : ""}`;
      saveBtn.disabled = !dirty;
    };
    const grid = h("div", { class: "grid" },
      qs.map((q) => {
        const b = h("button", {
          class: "qcell", "aria-pressed": String(selected.has(q.id)), dataset: { subject: q.subject },
          "aria-label": `第 ${q.number} 題 ${q.subject}`,
          onclick: () => {
            selected.has(q.id) ? selected.delete(q.id) : selected.add(q.id);
            b.setAttribute("aria-pressed", String(selected.has(q.id)));
            dirty = true;
            refreshCount();
          },
        }, q.number);
        return b;
      }));
    saveBtn.onclick = async () => {
      const done = busy(saveBtn, "儲存中…");
      try {
        await api("/api/wrong", { method: "PUT", body: { exam: S.exam, qids: [...selected] } });
        await viewHome();
      } catch (ex) {
        alert(ex.message);
        done();
      }
    };
    refreshCount();

    const legend = h("div", { class: "legend" },
      Object.entries({ 物理: "--phy", 化學: "--chem", 生物: "--bio", 地科: "--earth" }).map(([n, v]) => h("span", {}, h("i", { style: `background:var(${v})` }), n)));

    const wrongQs = qs.filter((q) => S.state.wrong.includes(q.id));
    const list = wrongQs.length
      ? h("div", { class: "card" }, wrongQs.map((q) => {
          const a = attemptOf(q.id);
          const status = a?.done ? h("span", { class: "tag ok" }, "已診斷") : a ? h("span", { class: "tag warn" }, "進行中") : h("span", { class: "tag" }, "未診斷");
          return h("div", { class: "qitem" },
            h("span", { class: "num" }, `${q.number}`),
            h("div", { class: "info" }, h("div", {}, subjectTag(q.subject), " ", q.topic), h("div", { class: "muted" }, q.chapter)),
            status,
            h("button", { class: "small", onclick: () => (location.hash = `#q/${q.id}`) }, a?.done ? "查看" : a ? "繼續" : "開始"));
        }))
      : h("p", { class: "muted" }, "還沒有儲存錯題。先在上面點選題號，再按「儲存錯題」。");

    const doneCount = S.state.attempts.filter((a) => a.done).length;
    app.replaceChildren(
      tabs,
      h("h2", {}, "一、點選你答錯的題號"),
      h("p", { class: "muted" }, "猜對的題目也建議點進來——猜對不代表會。"),
      legend, grid,
      h("div", { class: "row savebar" }, count, h("span", { class: "spacer" }), saveBtn),
      h("h2", {}, "二、逐題診斷"),
      list,
      h("h2", {}, "三、我的弱點與學習計劃"),
      doneCount
        ? h("div", { class: "card" },
            h("p", {}, `已完成 ${doneCount}／${S.state.wrong.length} 題的診斷。`),
            h("button", { class: "primary", onclick: () => (location.hash = "#plan") }, S.state.plan ? "查看學習計劃" : "查看弱點分析"))
        : h("p", { class: "muted" }, "完成至少一題的診斷後，這裡會出現你的弱點分析。")
    );
  }

  // ---------- 單題診斷 ----------
  function stepDots(q, steps) {
    const byN = Object.fromEntries((steps || []).map((s) => [s.n, s.status]));
    return h("div", { class: "steps", "aria-label": "解題步驟檢核進度" },
      h("span", { class: "muted" }, "解題步驟："),
      Array.from({ length: q.stepCount }, (_, i) => {
        const st = byN[i + 1] || "untested";
        return h("span", { class: `step-dot ${st}`, title: `步驟 ${i + 1}：${STATUS_LABEL[st]}`, "aria-label": `步驟 ${i + 1} ${STATUS_LABEL[st]}` }, STATUS_MARK[st] || i + 1);
      }));
  }

  function questionCard(q) {
    const opts = Object.entries(q.options);
    return h("details", { class: "card qcard", open: true },
      h("summary", {}, h("strong", {}, `第 ${q.number} 題`), " ", subjectTag(q.subject), " ", h("span", { class: "tag" }, { single: "單選", multi: "多選", open: "非選" }[q.type]), h("span", { class: "hint" }, "題目")),
      h("p", { class: "muted" }, q.topic),
      h("p", { class: "stem" }, q.stem),
      opts.length ? h("ul", { class: "options" }, opts.map(([k, v]) => h("li", {}, `(${k}) ${v}`))) : null,
      q.hasFigure ? h("p", { class: "muted" }, "※ 這題有附圖或附表，請對照你的紙本試卷。") : null);
  }

  async function viewQuestion(qid) {
    app.replaceChildren(h("p", { class: "muted" }, "載入中…"));
    let attempt;
    try {
      const exam = Number(qid.match(/^E(\d+)-/)?.[1]);
      if (!S.state || S.exam !== exam) await loadExam(exam);
      attempt = (await api(`/api/attempt?qid=${encodeURIComponent(qid)}`)).attempt;
    } catch (ex) {
      app.replaceChildren(h("p", { class: "error" }, ex.message));
      return;
    }
    const q = qById(qid);
    if (!q) return void app.replaceChildren(h("p", { class: "error" }, "找不到這一題。"));

    const back = h("button", { class: "small ghost", onclick: () => (location.hash = "") }, "← 回錯題清單");
    const dots = h("div");
    const chat = h("div", { class: "chat", "aria-live": "polite" });
    const below = h("div");
    const setDots = (steps) => dots.replaceChildren(stepDots(q, steps));
    const addMsg = (role, text) => {
      const m = h("div", { class: `msg ${role}` }, text);
      chat.append(m);
      m.scrollIntoView({ block: "end", behavior: "smooth" });
      return m;
    };

    function showDone(res) {
      const causes = (res.causes || []).map((c) => h("li", {}, h("strong", {}, S.session.causes[c.code]?.label || c.code), `：${c.evidence}`));
      const nextQ = (S.questions[S.exam] || []).find((x) => S.state.wrong.includes(x.id) && x.id !== qid && !attemptOf(x.id)?.done);
      below.replaceChildren(
        h("div", { class: "card" },
          h("h3", { style: "margin-top:0" }, "這一題的診斷"),
          h("p", {}, res.summary),
          causes.length ? h("div", {}, h("p", { class: "muted" }, "錯因與證據"), h("ul", {}, causes)) : null,
          res.review
            ? h("details", {}, h("summary", {}, "看完整解題步驟"),
                h("p", {}, h("strong", {}, `正確答案：${res.review.answer.join("、")}`)),
                h("ol", {}, res.review.steps.map((s) => h("li", {}, h("strong", {}, s.do), h("br"), s.detail))),
                h("p", { class: "muted" }, `補救建議：${res.review.remedy}`))
            : null),
        h("div", { class: "row no-print" },
          h("button", {
            class: "small", onclick: async () => {
              if (!confirm("重新診斷會清除這一題目前的對話紀錄，確定嗎？")) return;
              await api("/api/attempt/reset", { method: "POST", body: { qid } });
              S.state = null;
              viewQuestion(qid);
            },
          }, "重新診斷這一題"),
          h("span", { class: "spacer" }),
          nextQ ? h("button", { class: "primary", onclick: () => (location.hash = `#q/${nextQ.id}`) }, `下一題（第 ${nextQ.number} 題）→`)
                : h("button", { class: "primary", onclick: () => (location.hash = "#plan") }, "看我的弱點分析 →")));
    }

    function showComposer(turnsLeft) {
      const ta = h("textarea", { rows: 2, maxlength: 500, placeholder: "用自己的話回答…", "aria-label": "你的回答" });
      const send = h("button", { class: "primary" }, "送出");
      const left = h("div", { class: "muted" });
      const setLeft = (n) => (left.textContent = n <= 3 ? `這一題還可以回答 ${n} 次` : "");
      setLeft(turnsLeft);
      const submit = async (text) => {
        text = text.trim();
        if (!text || send.disabled) return;
        ta.value = "";
        send.disabled = true;
        addMsg("student", text);
        const typing = addMsg("tutor typing", "思考中…");
        try {
          const res = await api("/api/chat", { method: "POST", body: { qid, text } });
          typing.remove();
          addMsg("tutor", res.reply);
          setDots(res.steps);
          upsertAttempt(res);
          if (res.done) return showDone(res);
          setLeft(res.turnsLeft);
        } catch (ex) {
          typing.remove();
          chat.lastChild?.remove(); // 把沒送成功的那句拿掉，放回輸入框
          ta.value = text;
          addMsg("tutor typing", `⚠ ${ex.message}`);
        }
        send.disabled = false;
        ta.focus();
      };
      send.onclick = () => submit(ta.value);
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(ta.value); } });
      below.replaceChildren(
        h("div", { class: "composer" }, ta, send),
        h("div", { class: "row" },
          h("button", { class: "small ghost", onclick: () => submit("直接告訴我") }, "這一步直接告訴我"),
          h("button", { class: "small ghost", onclick: () => submit("我想結束這一題的診斷") }, "結束這一題"),
          h("span", { class: "spacer" }), left));
    }

    function upsertAttempt(res) {
      const cur = attemptOf(qid);
      const data = { qid, steps: res.steps, causes: res.causes, summary: res.summary, done: res.done };
      if (cur) Object.assign(cur, data);
      else S.state.attempts.push(data);
    }

    function showStartForm() {
      let situation = null;
      const chosen = new Set();
      const optKeys = Object.keys(q.options);
      const openAns = h("input", { maxlength: 60, placeholder: "寫下你當時的答案（沒寫可留空）", "aria-label": "你當時的答案" });
      const chips = optKeys.map((k) => {
        const b = h("button", { class: "chip", "aria-pressed": "false", onclick: () => {
          if (q.type === "single") { chosen.clear(); chips.forEach((c) => c.setAttribute("aria-pressed", "false")); }
          chosen.has(k) ? chosen.delete(k) : chosen.add(k);
          b.setAttribute("aria-pressed", String(chosen.has(k)));
        } }, k);
        return b;
      });
      const sitChips = Object.entries(S.session.situations).map(([code, label]) => {
        const b = h("button", { class: "chip", "aria-pressed": "false", onclick: () => {
          situation = code;
          sitChips.forEach((c) => c.setAttribute("aria-pressed", "false"));
          b.setAttribute("aria-pressed", "true");
        } }, label);
        return b;
      });
      const note = h("textarea", { rows: 2, maxlength: 500, placeholder: "（選填）還記得當時怎麼想的嗎？" });
      const err = h("div", { class: "error", role: "alert" });
      const start = h("button", { class: "primary" }, "開始診斷");
      start.onclick = async () => {
        if (!situation) return void (err.textContent = "請先選擇當時的狀況。");
        err.textContent = "";
        const done = busy(start, "AI 準備中…");
        try {
          const res = await api("/api/chat", {
            method: "POST",
            body: { qid, start: { chosen: optKeys.length ? [...chosen].sort().join("") || "沒有作答" : openAns.value, situation, note: note.value } },
          });
          card.open = false;
          addMsg("tutor", res.reply);
          setDots(res.steps);
          upsertAttempt(res);
          res.done ? showDone(res) : showComposer(res.turnsLeft);
        } catch (ex) {
          err.textContent = ex.message;
          done();
        }
      };
      below.replaceChildren(h("div", { class: "card" },
        h("label", {}, q.type === "multi" ? "你當時選了哪些選項？（可複選）" : "你當時的答案"),
        optKeys.length ? h("div", { class: "chips" }, chips) : openAns,
        h("label", {}, "當時的狀況最接近哪一個？"),
        h("div", { class: "chips" }, sitChips),
        h("label", {}, "補充說明"), note,
        err,
        h("div", { class: "row" }, h("span", { class: "spacer" }), start)));
    }

    const card = questionCard(q);
    app.replaceChildren(h("div", { class: "row no-print" }, back), card, dots, chat, below);
    setDots(attempt?.steps);
    if (!attempt) return showStartForm();
    card.open = false; // 已開始追問：收合題目，把螢幕留給對話
    for (const m of attempt.transcript) addMsg(m.role, m.text);
    if (attempt.done) {
      showDone(attempt);
    } else {
      showComposer(Math.max(0, 12 - attempt.turns));
    }
  }

  // ---------- 弱點分析與學習計劃 ----------
  function bars(rows, max, { bad = false, suffix = "" } = {}) {
    return h("div", { class: "bars" }, rows.map(([label, val, text]) =>
      h("div", { class: "bar" },
        h("span", {}, label),
        h("div", { class: "track" }, h("div", { class: `fill ${bad ? "bad" : ""}`, style: `width:${max ? Math.round((val / max) * 100) : 0}%` })),
        h("span", { class: "val" }, text ?? `${val}${suffix}`))));
  }

  async function viewPlan() {
    app.replaceChildren(h("p", { class: "muted" }, "載入中…"));
    try {
      await loadExam(S.exam || S.session.exams[0]);
    } catch (ex) {
      return void app.replaceChildren(h("p", { class: "error" }, ex.message));
    }
    const st = S.state;
    const causes = S.session.causes;
    const done = st.attempts.filter((a) => a.done);
    const causeRows = Object.entries(st.causeCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => [causes[c]?.label || c, n]);
    const skillRows = st.skillMap.filter((s) => s.level != null).sort((a, b) => a.level - b.level).map((s) => [s.label, s.level, `${s.level}/5`]);
    const thin = st.skillMap.filter((s) => s.level == null).map((s) => s.label);

    const planBox = h("div");
    const err = h("div", { class: "error", role: "alert" });
    const gen = h("button", { class: "primary no-print" }, st.plan ? "依最新診斷重新產生" : "產生我的學習計劃");
    gen.onclick = async () => {
      err.textContent = "";
      const fin = busy(gen, "AI 規劃中，約需半分鐘…");
      try {
        const res = await api("/api/plan", { method: "POST", body: { exam: S.exam } });
        st.plan = res.plan;
        renderPlan();
        gen.textContent = "依最新診斷重新產生";
        gen.disabled = false;
      } catch (ex) {
        err.textContent = ex.message;
        fin();
      }
    };
    function renderPlan() {
      const p = st.plan;
      if (!p) return planBox.replaceChildren(h("p", { class: "muted" }, "按下方按鈕，AI 會根據你的診斷紀錄排出三週的補救計劃。"));
      planBox.replaceChildren(h("div", { class: "plan" },
        h("p", {}, p.overview),
        h("h3", {}, "優先處理的弱點"),
        h("ol", {}, p.weaknesses.map((w) => h("li", {},
          h("strong", {}, w.title), " ", h("span", { class: "tag" }, w.kind), " ", h("span", { class: "tag bad" }, causes[w.cause]?.label || w.cause),
          h("br"), h("span", { class: "muted" }, `證據：${w.evidence}`), h("br"), w.fix))),
        p.strengths.length ? h("div", {}, h("h3", {}, "做得到的部分"), h("ul", {}, p.strengths.map((s) => h("li", {}, s)))) : null,
        h("h3", {}, "三週計劃"),
        p.weeks.map((w) => h("div", { class: "week" },
          h("strong", {}, `第 ${w.week} 週：${w.focus}`),
          h("ul", {}, w.tasks.map((t) => h("li", {}, t))),
          h("p", { class: "muted" }, `自我檢核：${w.check}`))),
        p.habits.length ? h("div", {}, h("h3", {}, "考場作答習慣"), h("ul", {}, p.habits.map((s) => h("li", {}, s)))) : null,
        p.retest.length ? h("div", {}, h("h3", {}, "三週後重做"), h("p", {}, p.retest.map((x) => (/^\d+$/.test(x) ? `第 ${x} 題` : x)).join("、"))) : null));
    }
    renderPlan();

    const doneSorted = done.map((a) => ({ a, q: qById(a.qid) })).filter((x) => x.q).sort((x, y) => x.q.number - y.q.number);
    const perQuestion = doneSorted.length
      ? h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "逐題診斷"),
          doneSorted.map(({ a, q }) => h("div", { class: "qsum" },
            h("div", {}, h("strong", {}, `第 ${q.number} 題 `), subjectTag(q.subject), ` ${q.topic}`),
            h("div", { class: "row" }, [...new Set(a.causes.map((c) => c.code))].map((c) => h("span", { class: "tag bad" }, causes[c]?.label || c))),
            h("p", {}, a.summary))))
      : null;

    function reportText() {
      const who = S.session.student;
      const L = [`【自然科第 ${S.exam} 次模擬考 錯題診斷】`, `${who.cls} 班 ${who.seat} 號 ${who.name}`, `錯題 ${st.wrong.length} 題，已診斷 ${done.length} 題`, ""];
      if (causeRows.length) L.push("■ 錯因分布", ...causeRows.map(([l, n]) => `・${l}：${n} 題`), "");
      if (doneSorted.length) L.push("■ 逐題診斷", ...doneSorted.map(({ a, q }) => `第 ${q.number} 題（${q.subject}・${q.topic}）\n${a.summary}`), "");
      const p = st.plan;
      if (p) {
        L.push("■ 整體診斷", p.overview, "", "■ 優先處理的弱點", ...p.weaknesses.map((w, i) => `${i + 1}. ${w.title}（${w.kind}）\n   ${w.fix}`), "");
        for (const w of p.weeks) L.push(`■ 第 ${w.week} 週：${w.focus}`, ...w.tasks.map((t) => `□ ${t}`), `自我檢核：${w.check}`, "");
        if (p.habits.length) L.push("■ 考場作答習慣", ...p.habits.map((x) => `・${x}`), "");
      }
      return L.join("\n");
    }
    const tip = h("span", { class: "muted", role: "status" });
    const shareBtn = h("button", { class: "small", onclick: async () => {
      const text = reportText();
      try {
        if (navigator.share) await navigator.share({ title: "錯題診斷報告", text });
        else { await navigator.clipboard.writeText(text); tip.textContent = "已複製，可貼到記事本或 LINE"; }
      } catch (ex) {
        if (ex.name !== "AbortError") tip.textContent = "無法分享，請長按畫面文字自行複製";
      }
    } }, navigator.share ? "分享文字版" : "複製文字版");

    app.replaceChildren(
      h("div", { class: "row no-print" }, h("button", { class: "small ghost", onclick: () => (location.hash = "") }, "← 回錯題清單"), h("span", { class: "spacer" }), shareBtn),
      h("p", { class: "muted no-print" }, tip),
      h("h2", {}, `第 ${S.exam} 次模擬考　${S.session.student.cls} 班 ${S.session.student.seat} 號 ${S.session.student.name}`),
      h("p", { class: "muted" }, `錯題 ${st.wrong.length} 題，已完成診斷 ${done.length} 題。`),
      h("div", { class: "card" },
        h("h3", { style: "margin-top:0" }, "錯因分布（出現在幾題中）"),
        causeRows.length ? bars(causeRows, Math.max(...causeRows.map((r) => r[1])), { bad: true, suffix: " 題" }) : h("p", { class: "muted" }, "尚無資料。")),
      h("div", { class: "card" },
        h("h3", { style: "margin-top:0" }, "能力向度（0–5 級）"),
        h("p", { class: "muted" }, "只根據你「錯題」中各解題步驟的表現計算，所以會比你的真實程度低；重點是看哪一項相對最弱。"),
        skillRows.length ? bars(skillRows, 5) : h("p", { class: "muted" }, "診斷的題數還不夠，多完成幾題後才會出現。"),
        thin.length ? h("p", { class: "muted" }, `資料不足、暫不評級：${thin.join("、")}`) : null),
      perQuestion || "",
      h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "學習計劃"), planBox, err, h("div", { class: "row" }, h("span", { class: "spacer" }), gen))
    );
  }

  // ---------- 路由 ----------
  function render() {
    const who = document.getElementById("who");
    const out = document.getElementById("logout");
    if (!S.session) {
      who.textContent = "";
      out.hidden = true;
      return viewLogin();
    }
    who.textContent = `${S.session.student.cls} 班 ${S.session.student.seat} 號`;
    out.hidden = false;
    const hash = location.hash.slice(1);
    if (hash.startsWith("q/")) return viewQuestion(decodeURIComponent(hash.slice(2)));
    if (hash === "plan") return viewPlan();
    return viewHome();
  }

  document.getElementById("logout").onclick = () => { if (confirm("確定要登出嗎？你的紀錄已存在伺服器，重新登入後可以繼續。")) logout(); };
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  render();
})();
