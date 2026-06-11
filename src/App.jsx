import { useState, useEffect, useCallback } from "react";

const C = {
  bg: "#040d1c", surface: "#080f1e", surfaceHigh: "#0d1a30",
  border: "#152a45", accent: "#00e5ff", accent2: "#ff4d6d",
  gold: "#ffd166", green: "#06ffa5", purple: "#b48eff",
  text: "#e8f4ff", muted: "#3a6a8a", mutedLight: "#5a8aaa",
};

// ─── Utilities ────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, "0");
const localISO = (y, mo, d, h, mi) => `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00`;
const parseLocal = s => new Date(typeof s === "string" && !s.includes("T") ? s + "T00:00:00" : s);
const fmt = (d) => { const dt = d instanceof Date ? d : parseLocal(d); return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`; };
const fmtDate = (d) => { const dt = d instanceof Date ? d : parseLocal(d); return dt.toLocaleDateString("ja-JP", { month: "short", day: "numeric", weekday: "short" }); };
const fmtTime = (d) => { const dt = d instanceof Date ? d : parseLocal(d); return dt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const todayStr = () => { const n = new Date(); return localISO(n.getFullYear(), n.getMonth()+1, n.getDate(), n.getHours(), n.getMinutes()); };

const DURATION_OPTIONS = [
  { label: "15分", value: 15 }, { label: "30分", value: 30 }, { label: "1時間", value: 60 },
  { label: "1時間30分", value: 90 }, { label: "2時間", value: 120 }, { label: "3時間", value: 180 },
];

// ─── Storage ─────────────────────────────────────────────────────
const KEY = (id) => `schedroom_${id}`;
async function saveRoom(id, data) {
  const json = JSON.stringify(data);
  if (window.storage?.set) { try { await window.storage.set(KEY(id), json, true); return true; } catch {} }
  try { localStorage.setItem(KEY(id), json); return true; } catch { return false; }
}
async function loadRoom(id) {
  if (window.storage?.get) { try { const r = await window.storage.get(KEY(id), true); if (r) return JSON.parse(r.value); } catch {} }
  try { const r = localStorage.getItem(KEY(id)); return r ? JSON.parse(r) : null; } catch { return null; }
}
function genRoomId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

// ─── Slot computation（15分刻み・時間帯フィルタ付き）─────────────
function computeFreeSlots(events, startDate, endDate, durationMin, timeFrom, timeTo) {
  // timeFrom/timeTo は "HH:MM" 形式（例 "09:00", "17:00"）、null なら制限なし
  const slots = [], dur = durationMin * 60 * 1000;
  const step = 15 * 60 * 1000; // 15分刻み

  // 開始を15分単位に揃える
  let cursor = new Date(startDate instanceof Date ? startDate : parseLocal(startDate));
  cursor = new Date(Math.ceil(cursor.getTime() / step) * step);
  const end = new Date(endDate instanceof Date ? endDate : parseLocal(endDate));

  const busy = events
    .map(e => ({ s: parseLocal(e.start), e: parseLocal(e.end) }))
    .sort((a, b) => a.s - b.s);

  const [fromH, fromM] = timeFrom ? timeFrom.split(":").map(Number) : [0, 0];
  const [toH, toM]     = timeTo   ? timeTo.split(":").map(Number)   : [23, 59];

  while (cursor < end) {
    const slotEnd = new Date(cursor.getTime() + dur);
    if (slotEnd > end) break;

    // 時間帯フィルタ
    const cH = cursor.getHours(), cM = cursor.getMinutes();
    const eH = slotEnd.getHours(), eM = slotEnd.getMinutes();
    const afterFrom = cH * 60 + cM >= fromH * 60 + fromM;
    const beforeTo  = eH * 60 + eM <= toH  * 60 + toM;

    if (timeFrom && timeTo && (!afterFrom || !beforeTo)) {
      // 時間帯外 → 翌日のfromHへジャンプ
      const next = new Date(cursor);
      if (!afterFrom) {
        next.setHours(fromH, fromM, 0, 0);
      } else {
        next.setDate(next.getDate() + 1);
        next.setHours(fromH, fromM, 0, 0);
      }
      cursor = next;
      continue;
    }

    const conflict = busy.find(b => b.s < slotEnd && b.e > cursor);
    if (conflict) {
      // 衝突した予定の終了時刻を15分単位に切り上げてジャンプ
      cursor = new Date(Math.ceil(conflict.e.getTime() / step) * step);
    } else {
      slots.push({ start: new Date(cursor), end: slotEnd });
      cursor = new Date(cursor.getTime() + step); // 15分ずつずらして次の候補へ
    }
  }
  return slots;
}

function intersectSlots(allSlots) {
  if (!allSlots.length) return [];
  let result = allSlots[0];
  for (let i = 1; i < allSlots.length; i++) {
    const next = [];
    for (const a of result) for (const b of allSlots[i]) {
      const s = new Date(Math.max(+a.start, +b.start));
      const e = new Date(Math.min(+a.end, +b.end));
      if (s < e) next.push({ start: s, end: e });
    }
    result = next;
  }
  return result;
}

function makeGCalLink(title, start, end, desc = "") {
  const f = d => (d instanceof Date ? d : parseLocal(d)).toISOString().replace(/[-:]/g, "").replace(".000", "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(start)}/${f(end)}&details=${encodeURIComponent(desc)}`;
}

// ─── Parser ───────────────────────────────────────────────────────
function parseScheduleText(text, startDate) {
  const year = parseLocal(startDate).getFullYear();
  const events = [];
  for (const line of text.split("\n").map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/(\d{1,2})[\/月](\d{1,2})[日（\(]?[月火水木金土日]?[）\)]?\s*(\d{1,2}):(\d{2})[〜~\-–](\d{1,2}):(\d{2})\s*(.*)/);
    if (m) {
      const [, month, day, sh, sm, eh, em, title] = m;
      events.push({
        title: title.trim() || "予定",
        start: localISO(year, Number(month), Number(day), Number(sh), Number(sm)),
        end:   localISO(year, Number(month), Number(day), Number(eh), Number(em)),
      });
    }
  }
  return events;
}

function makeCalendarPrompt(startDate, endDate) {
  return `私のGoogleカレンダーの予定を${startDate}から${endDate}まで全て教えてください。\n\n必ず以下の形式で1行ずつ出力してください（この形式以外は使わないでください）：\n月/日（曜日）HH:MM〜HH:MM タイトル\n\n出力例：\n6/5（木）10:00〜11:00 チームMTG\n6/6（金）14:00〜15:00 クライアント面談\n\n予定がない場合は「予定なし」とだけ出力してください。表形式や箇条書きは使わないでください。`;
}

// ─── App ──────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("top");
  const [roomId, setRoomId] = useState(null);
  const [joinInput, setJoinInput] = useState("");

  return (
    <Page>
      {screen === "top" && <TopScreen
        onCreate={async () => {
          const id = genRoomId();
          await saveRoom(id, { id, submissions: [], createdAt: new Date().toISOString() });
          setRoomId(id); setScreen("host");
        }}
        onJoin={() => setScreen("join")}
      />}
      {screen === "join" && <JoinScreen
        value={joinInput} onChange={setJoinInput}
        onBack={() => setScreen("top")}
        onJoin={async () => {
          const id = joinInput.trim().toUpperCase();
          const data = await loadRoom(id);
          if (!data) { alert("ルームが見つかりません。IDを確認してください。"); return; }
          setRoomId(id); setScreen("member");
        }}
      />}
      {screen === "member" && <MemberScreen roomId={roomId} onBack={() => setScreen("top")} />}
      {screen === "host"   && <HostScreen   roomId={roomId} onBack={() => setScreen("top")} />}
      <GlobalStyle />
    </Page>
  );
}

// ─── TOP ─────────────────────────────────────────────────────────
function TopScreen({ onCreate, onJoin }) {
  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "48px 20px 32px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
      <h1 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 900, letterSpacing: "-2px", fontFamily: "monospace" }}>
        <span style={{ color: C.accent }}>SCHED</span><span style={{ color: C.text }}>SYNC</span>
      </h1>
      <p style={{ margin: "0 0 40px", color: C.muted, fontSize: 13 }}>予定テキスト貼り付け → 全員の空き時間を自動算出</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ModeBtn color={C.accent} emoji="✨" title="ルームを作成する" desc="主催者として部屋を作り、参加者にIDを共有する" onClick={onCreate} />
        <ModeBtn color={C.gold}   emoji="🔑" title="ルームに参加する" desc="主催者から届いたルームIDを入力して参加する"    onClick={onJoin}  />
      </div>
    </div>
  );
}
function ModeBtn({ color, emoji, title, desc, onClick }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? `${color}18` : C.surface, border: `1.5px solid ${h ? color : C.border}`, borderRadius: 16, padding: "20px 18px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", boxShadow: h ? `0 0 24px ${color}33` : "none", display: "flex", gap: 14, alignItems: "flex-start", width: "100%" }}>
      <span style={{ fontSize: 26 }}>{emoji}</span>
      <div>
        <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: C.text }}>{title}</p>
        <p style={{ margin: 0, fontSize: 12, color: C.mutedLight, lineHeight: 1.5 }}>{desc}</p>
      </div>
    </button>
  );
}

// ─── JOIN ─────────────────────────────────────────────────────────
function JoinScreen({ value, onChange, onJoin, onBack }) {
  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "24px 20px" }}>
      <BackBtn onClick={onBack} />
      <SecTitle color={C.gold}>🔑 ルームに参加</SecTitle>
      <Card>
        <FieldLabel>ルームID（6文字）</FieldLabel>
        <input value={value} onChange={e => onChange(e.target.value.toUpperCase())} placeholder="例：AB12CD" maxLength={6}
          style={{ ...iSt, textAlign: "center", fontSize: 24, letterSpacing: "8px", fontWeight: 900, marginBottom: 14 }} />
        <NBtn color={C.gold} onClick={onJoin} full>参加する →</NBtn>
      </Card>
    </div>
  );
}

// ─── MEMBER ───────────────────────────────────────────────────────
function MemberScreen({ roomId, onBack }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [roomData, setRoomData] = useState(null);
  // 条件はルームから取得（主催者が設定したもの）
  const [startDate, setStartDate] = useState(() => todayStr());
  const [endDate,   setEndDate]   = useState(() => fmt(addDays(new Date(), 14)));
  const [duration,  setDuration]  = useState(60);
  const [timeFrom,  setTimeFrom]  = useState("");
  const [timeTo,    setTimeTo]    = useState("");
  const [pastedText, setPastedText] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [freeSlots, setFreeSlots] = useState([]);
  const [copyState, setCopyState] = useState("idle");

  // ルームデータ読み込み（主催者設定の条件を反映）
  useEffect(() => {
    if (!roomId) return;
    loadRoom(roomId).then(data => {
      if (!data) return;
      setRoomData(data);
      if (data.startDate) setStartDate(data.startDate);
      if (data.endDate)   setEndDate(data.endDate);
      if (data.duration)  setDuration(data.duration);
      if (data.timeFrom)  setTimeFrom(data.timeFrom);
      if (data.timeTo)    setTimeTo(data.timeTo);
    });
  }, [roomId]);

  const prompt = makeCalendarPrompt(startDate, endDate);

  const copyPrompt = useCallback(() => {
    const doCopy = () => {
      const ta = document.createElement("textarea");
      ta.value = prompt; ta.style.cssText = "position:fixed;left:-9999px;top:-9999px";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); setCopyState("copied"); }
      catch { setCopyState("error"); }
      document.body.removeChild(ta);
      setTimeout(() => setCopyState("idle"), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(prompt)
        .then(() => { setCopyState("copied"); setTimeout(() => setCopyState("idle"), 2500); })
        .catch(doCopy);
    } else doCopy();
  }, [prompt]);

  const analyze = () => {
    if (!pastedText.trim()) { setError("予定テキストを貼り付けてください"); return; }
    setError(null);
    try {
      const events = parseScheduleText(pastedText, startDate);
      const slots = computeFreeSlots(events, startDate, endDate, duration, timeFrom || null, timeTo || null);
      setFreeSlots(slots.map(s => ({ start: s.start, end: s.end, enabled: true })));
      setStep(4);
    } catch (e) { setError("解析に失敗しました: " + e.message); }
  };

  const toggleSlot = (i) => setFreeSlots(prev => prev.map((s, idx) => idx === i ? { ...s, enabled: !s.enabled } : s));

  const submit = async () => {
    if (!name.trim()) { setError("名前を入力してください"); return; }
    const enabled = freeSlots.filter(s => s.enabled);
    if (enabled.length === 0) { setError("送信する空き時間が1件もありません"); return; }
    setLoading(true); setError(null);
    try {
      const room = await loadRoom(roomId);
      if (!room) throw new Error("ルームが見つかりません");
      const others = (room.submissions || []).filter(s => s.name !== name.trim());
      room.submissions = [...others, {
        name: name.trim(),
        slots: enabled.map(s => ({ start: fmt(s.start), end: fmt(s.end) })),
        submittedAt: new Date().toISOString(),
      }];
      await saveRoom(roomId, room);
      setStep(5);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const enabledCount = freeSlots.filter(s => s.enabled).length;

  // 主催者が設定した条件の表示
  const hasConditions = roomData && (roomData.timeFrom || roomData.timeTo || roomData.startDate);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px" }}>
      <BackBtn onClick={onBack} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <SecTitle color={C.accent}>👤 空き時間を送信</SecTitle>
        <RoomBadge id={roomId} />
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 24 }}>
        {[1,2,3,4].map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800,
              background: step > s ? C.green : step === s ? C.accent : C.surfaceHigh,
              color: step >= s ? C.bg : C.muted,
              border: `2px solid ${step > s ? C.green : step === s ? C.accent : C.border}`,
              boxShadow: step === s ? `0 0 14px ${C.accent}88` : "none", transition: "all 0.3s",
            }}>{step > s ? "✓" : s}</div>
            {i < 3 && <div style={{ width: 18, height: 2, background: step > s ? C.green : C.border, borderRadius: 1 }} />}
          </div>
        ))}
        <span style={{ color: C.mutedLight, fontSize: 11, marginLeft: 8 }}>
          {["設定", "Claudeへ", "貼り付け", "編集・送信"][Math.min(step,4)-1]}
        </span>
      </div>

      {/* STEP 5: 完了 */}
      {step === 5 && (
        <Card style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 20, fontWeight: 900, color: C.green, margin: "0 0 8px" }}>送信完了！</p>
          <p style={{ color: C.mutedLight, fontSize: 13, margin: "0 0 4px" }}>{name} さんの空き時間</p>
          <p style={{ color: C.accent, fontWeight: 900, fontSize: 32, margin: 0 }}>{enabledCount}<span style={{ fontSize: 14, fontWeight: 400 }}>件</span></p>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 20, lineHeight: 1.7 }}>主催者がルーム画面を更新すると<br />あなたの空き時間が反映されます</p>
          <NBtn color={C.muted} onClick={onBack} full style={{ marginTop: 20, background: C.surfaceHigh, boxShadow: "none" }}>トップに戻る</NBtn>
        </Card>
      )}

      {/* STEP 1: 設定 */}
      {step === 1 && (
        <Card>
          {hasConditions && (
            <div style={{ background: `${C.gold}11`, border: `1px solid ${C.gold}44`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: C.gold, fontWeight: 700 }}>👑 主催者の設定条件</p>
              <p style={{ margin: 0, fontSize: 12, color: C.mutedLight, lineHeight: 1.6 }}>
                {roomData.startDate && `期間: ${fmtDate(roomData.startDate)} 〜 ${fmtDate(roomData.endDate)}`}
                {roomData.timeFrom && `　時間帯: ${roomData.timeFrom} 〜 ${roomData.timeTo}`}
              </p>
            </div>
          )}
          <FieldLabel>あなたの名前</FieldLabel>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：田中 太郎" style={{ ...iSt, marginBottom: 14 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div><FieldLabel>開始日時</FieldLabel><input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} style={iSt} /></div>
            <div><FieldLabel>終了日時</FieldLabel><input type="datetime-local" value={endDate}   onChange={e => setEndDate(e.target.value)}   style={iSt} /></div>
          </div>
          <FieldLabel>必要な空き時間</FieldLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {DURATION_OPTIONS.map(o => <DurChip key={o.value} label={o.label} active={duration === o.value} onClick={() => setDuration(o.value)} />)}
          </div>
          {(timeFrom || timeTo) && (
            <div style={{ background: `${C.accent}11`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "8px 12px", marginBottom: 4 }}>
              <p style={{ margin: 0, fontSize: 12, color: C.accent }}>🕐 時間帯フィルタ：{timeFrom} 〜 {timeTo} の枠のみ算出</p>
            </div>
          )}
          {error && <ErrBox msg={error} />}
          <NBtn color={C.accent} onClick={() => { if (!name.trim()) { setError("名前を入力してください"); return; } setError(null); setStep(2); }} full style={{ marginTop: 14 }}>次へ →</NBtn>
        </Card>
      )}

      {/* STEP 2: Claudeへ */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card style={{ borderColor: `${C.purple}55` }}>
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: C.purple }}>📋 Claudeのチャットで予定を取得する</p>
            <p style={{ color: C.mutedLight, fontSize: 13, lineHeight: 1.7, margin: "0 0 14px" }}>
              下のプロンプトをコピーして、<strong style={{ color: C.text }}>Claudeのチャット画面</strong>に貼り付けてください。
            </p>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: C.text, lineHeight: 1.7, userSelect: "all", whiteSpace: "pre-wrap" }}>{prompt}</div>
            <button onClick={copyPrompt} style={{
              width: "100%", padding: "12px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 800, transition: "all 0.2s", border: "2px solid",
              background: copyState === "copied" ? `${C.green}22` : copyState === "error" ? `${C.accent2}22` : `${C.purple}22`,
              borderColor: copyState === "copied" ? C.green : copyState === "error" ? C.accent2 : C.purple,
              color: copyState === "copied" ? C.green : copyState === "error" ? C.accent2 : C.purple,
            }}>
              {copyState === "copied" ? "✓ コピーしました！" : copyState === "error" ? "⚠ 手動で長押しコピーしてください" : "📋 プロンプトをコピー"}
            </button>
          </Card>
          <Card>
            <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: C.gold }}>手順</p>
            {["Claudeのチャット画面を新しく開く", "プロンプトを貼り付けて送信", "Claudeが返した予定一覧をコピー", "このアプリに戻って「次へ」を押す"].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
                <span style={{ color: C.gold, fontWeight: 900, fontSize: 13, minWidth: 16 }}>{i+1}</span>
                <span style={{ color: C.mutedLight, fontSize: 13, lineHeight: 1.5 }}>{t}</span>
              </div>
            ))}
          </Card>
          <NBtn color={C.accent} onClick={() => setStep(3)} full>Claudeから予定を取得したら次へ →</NBtn>
          <BackStep onClick={() => setStep(1)} />
        </div>
      )}

      {/* STEP 3: 貼り付け */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: C.accent }}>📝 Claudeの返答を貼り付け</p>
            <p style={{ color: C.mutedLight, fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
              ClaudeがGoogleカレンダーの予定を返答したテキストをそのまま貼り付けてください。
            </p>
            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)}
              placeholder={"例：\n6/5（木）10:00〜11:00 チームMTG\n6/6（金）14:00〜15:00 クライアント面談"}
              rows={10} style={{ ...iSt, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }} />
            {error && <ErrBox msg={error} />}
          </Card>
          <NBtn color={C.accent} onClick={analyze} full>🔍 空き時間を自動算出</NBtn>
          <BackStep onClick={() => setStep(2)} />
        </div>
      )}

      {/* STEP 4: 編集・送信 */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.green }}>✅ 空き時間を確認・編集</p>
              <span style={{ color: C.accent, fontWeight: 900, fontSize: 16 }}>{enabledCount}<span style={{ fontSize: 11, color: C.mutedLight, fontWeight: 400 }}>/{freeSlots.length}件</span></span>
            </div>
            <p style={{ color: C.mutedLight, fontSize: 12, margin: "0 0 14px", lineHeight: 1.6 }}>
              タップして参加できない日程を外してください<br/>✅ 送信する　❌ 送信しない
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setFreeSlots(p => p.map(s => ({ ...s, enabled: true })))}
                style={{ flex: 1, padding: "7px", background: `${C.green}18`, border: `1px solid ${C.green}44`, borderRadius: 8, color: C.green, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                すべて選択
              </button>
              <button onClick={() => setFreeSlots(p => p.map(s => ({ ...s, enabled: false })))}
                style={{ flex: 1, padding: "7px", background: `${C.accent2}18`, border: `1px solid ${C.accent2}44`, borderRadius: 8, color: C.accent2, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                すべて解除
              </button>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {freeSlots.map((slot, i) => (
                <div key={i} onClick={() => toggleSlot(i)} style={{
                  padding: "11px 14px", borderRadius: 10, cursor: "pointer",
                  background: slot.enabled ? `${C.green}12` : `${C.accent2}0a`,
                  border: `1.5px solid ${slot.enabled ? C.green + "66" : C.accent2 + "44"}`,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  transition: "all 0.15s", opacity: slot.enabled ? 1 : 0.5,
                }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, color: slot.enabled ? C.text : C.mutedLight, fontWeight: 600 }}>{fmtDate(slot.start)}</p>
                    <p style={{ margin: 0, fontSize: 12, color: slot.enabled ? C.mutedLight : C.muted }}>{fmtTime(slot.start)} 〜 {fmtTime(slot.end)}</p>
                  </div>
                  <span style={{ fontSize: 18 }}>{slot.enabled ? "✅" : "❌"}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <FieldLabel>送信者名の確認</FieldLabel>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="名前" style={{ ...iSt, marginBottom: 4 }} />
          </Card>
          {error && <ErrBox msg={error} />}
          <NBtn color={C.green} onClick={submit} loading={loading} full style={{ color: C.bg }}>
            {loading ? "⏳ 送信中…" : `📤 ${enabledCount}件の空き時間を送信する`}
          </NBtn>
          <BackStep onClick={() => setStep(3)} />
        </div>
      )}
    </div>
  );
}

// ─── HOST ─────────────────────────────────────────────────────────
function HostScreen({ roomId, onBack }) {
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commonSlots, setCommonSlots] = useState([]);
  const [computed, setComputed] = useState(false);
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [copied, setCopied] = useState(false);

  // 主催者が設定する条件
  const [condStart,    setCondStart]    = useState(() => todayStr());
  const [condEnd,      setCondEnd]      = useState(() => fmt(addDays(new Date(), 14)));
  const [condDuration, setCondDuration] = useState(60);
  const [condTimeFrom, setCondTimeFrom] = useState("");
  const [condTimeTo,   setCondTimeTo]   = useState("");
  const [condSaved,    setCondSaved]    = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await loadRoom(roomId);
    setRoom(data);
    if (data?.startDate)  setCondStart(data.startDate);
    if (data?.endDate)    setCondEnd(data.endDate);
    if (data?.duration)   setCondDuration(data.duration);
    if (data?.timeFrom)   setCondTimeFrom(data.timeFrom);
    if (data?.timeTo)     setCondTimeTo(data.timeTo);
    if (data?.startDate)  setCondSaved(true);
    setLoading(false);
  }, [roomId]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveConditions = async () => {
    const data = await loadRoom(roomId);
    if (!data) return;
    Object.assign(data, { startDate: condStart, endDate: condEnd, duration: condDuration, timeFrom: condTimeFrom, timeTo: condTimeTo });
    await saveRoom(roomId, data);
    setRoom(data);
    setCondSaved(true);
    alert("条件を保存しました！参加者に共有してください。");
  };

  const compute = () => {
    const subs = room?.submissions || [];
    if (subs.length < 2) return;
    const tf = condTimeFrom || null, tt = condTimeTo || null;
    const allSlots = subs.map(s => s.slots.map(sl => ({ start: parseLocal(sl.start), end: parseLocal(sl.end) })));
    // 時間帯フィルタを共通スロットにも適用
    let common = intersectSlots(allSlots);
    if (tf && tt) {
      const [fh, fm] = tf.split(":").map(Number);
      const [th, tm] = tt.split(":").map(Number);
      common = common.filter(s => {
        const sh = s.start.getHours(), sm2 = s.start.getMinutes();
        const eh = s.end.getHours(),   em2 = s.end.getMinutes();
        return sh * 60 + sm2 >= fh * 60 + fm && eh * 60 + em2 <= th * 60 + tm;
      });
    }
    setCommonSlots(common);
    setComputed(true); setSelected(null);
  };

  const shareText = `【スケジュール調整】\nルームID: ${roomId}\n\n参加手順：\n1. Claudeアプリでこのアプリを開く\n2.「ルームに参加する」をタップ\n3. ルームID「${roomId}」を入力\n4. 手順に従って空き時間を送信してください`;

  const copyShare = () => {
    const ta = document.createElement("textarea");
    ta.value = shareText; ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const gcalLink = selected ? makeGCalLink(title || "ミーティング", selected.start, selected.end, desc) : null;
  const subs = room?.submissions || [];

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px" }}>
      <BackBtn onClick={onBack} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <SecTitle color={C.gold}>👑 主催者ビュー</SecTitle>
        <RoomBadge id={roomId} />
      </div>

      {/* 条件設定 */}
      <Card style={{ borderColor: `${C.accent}44`, marginBottom: 14 }}>
        <p style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 800, color: C.accent }}>⚙️ 募集条件を設定する</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div><FieldLabel>開始日時</FieldLabel><input type="datetime-local" value={condStart} onChange={e => setCondStart(e.target.value)} style={iSt} /></div>
          <div><FieldLabel>終了日時</FieldLabel><input type="datetime-local" value={condEnd}   onChange={e => setCondEnd(e.target.value)}   style={iSt} /></div>
        </div>
        <FieldLabel>必要な時間</FieldLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {DURATION_OPTIONS.map(o => <DurChip key={o.value} label={o.label} active={condDuration === o.value} onClick={() => setCondDuration(o.value)} />)}
        </div>
        <FieldLabel>希望時間帯（任意）例: 09:00 〜 17:00</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <input type="time" value={condTimeFrom} onChange={e => setCondTimeFrom(e.target.value)} style={iSt} placeholder="09:00" />
          <span style={{ color: C.muted, textAlign: "center" }}>〜</span>
          <input type="time" value={condTimeTo}   onChange={e => setCondTimeTo(e.target.value)}   style={iSt} placeholder="17:00" />
        </div>
        <NBtn color={C.accent} onClick={saveConditions} full>
          💾 条件を保存して参加者に反映
        </NBtn>
        {condSaved && <p style={{ color: C.green, fontSize: 12, textAlign: "center", marginTop: 8 }}>✓ 保存済み・参加者の画面に反映されます</p>}
      </Card>

      {/* 共有 */}
      <Card style={{ borderColor: `${C.gold}44`, marginBottom: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 800, color: C.gold }}>📤 参加者に共有する</p>
        <div style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "1px" }}>Room ID</p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: C.gold, letterSpacing: "6px", fontFamily: "monospace" }}>{roomId}</p>
          </div>
          <button onClick={copyShare} style={{ background: copied ? `${C.green}22` : `${C.gold}22`, border: `1px solid ${copied ? C.green : C.gold}`, borderRadius: 8, padding: "8px 14px", color: copied ? C.green : C.gold, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            {copied ? "✓ コピー済" : "📋 共有文をコピー"}
          </button>
        </div>
      </Card>

      {/* 送信済み一覧 */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>
            送信済み <span style={{ color: C.accent, fontSize: 20, fontWeight: 900 }}>{subs.length}</span> 名
          </p>
          <button onClick={refresh} style={{ background: `${C.accent}15`, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: "6px 12px", color: C.accent, cursor: "pointer", fontSize: 12 }}>
            {loading ? "…" : "🔄 更新"}
          </button>
        </div>
        {subs.length === 0
          ? <p style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>まだ誰も送信していません</p>
          : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {subs.map((s, i) => (
                <div key={i} style={{ background: C.bg, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{s.name}</p>
                    <p style={{ margin: 0, fontSize: 11, color: C.muted }}>空き時間 {s.slots.length}件</p>
                  </div>
                  <span style={{ color: C.green, fontSize: 12, fontWeight: 600 }}>✓ 送信済み</span>
                </div>
              ))}
            </div>
        }
      </Card>

      {subs.length >= 2
        ? <NBtn color={C.gold} onClick={compute} full style={{ marginBottom: 14, color: "#1a1000" }}>🔍 全員の共通空き時間を算出</NBtn>
        : <p style={{ color: C.muted, fontSize: 12, textAlign: "center", marginBottom: 14 }}>2名以上の送信が必要です（現在 {subs.length}名）</p>
      }

      {/* 共通スロット */}
      {computed && (
        <Card style={{ marginBottom: 14 }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: commonSlots.length > 0 ? C.green : C.accent2 }}>
            {commonSlots.length > 0 ? `✅ 共通の空き時間 ${commonSlots.length}件` : "❌ 共通の空き時間が見つかりませんでした"}
          </p>
          {commonSlots.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>期間を広げるか、参加者に再送信してもらいましょう。</p>}
          <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {commonSlots.map((slot, i) => (
              <div key={i} onClick={() => setSelected(slot)} style={{
                padding: "12px 14px", borderRadius: 8, cursor: "pointer",
                background: selected === slot ? `${C.gold}22` : C.bg,
                border: `1.5px solid ${selected === slot ? C.gold : C.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                transition: "all 0.15s", boxShadow: selected === slot ? `0 0 12px ${C.gold}33` : "none",
              }}>
                <span style={{ fontSize: 13, color: C.text }}>{fmtDate(slot.start)}</span>
                <span style={{ fontSize: 13, color: C.mutedLight }}>{fmtTime(slot.start)} 〜 {fmtTime(slot.end)}</span>
                {selected === slot && <span style={{ fontSize: 11, color: C.gold, fontWeight: 800 }}>✓</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 予定作成 */}
      {selected && (
        <Card style={{ borderColor: `${C.accent}44` }}>
          <p style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: C.accent }}>📝 予定を作成</p>
          <div style={{ background: `${C.accent}11`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: C.accent, fontWeight: 600 }}>
              {fmtDate(selected.start)} {fmtTime(selected.start)} 〜 {fmtTime(selected.end)}
            </p>
          </div>
          <FieldLabel>イベントタイトル</FieldLabel>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例：チームミーティング" style={{ ...iSt, marginBottom: 12 }} />
          <FieldLabel>説明・場所など（任意）</FieldLabel>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="アジェンダ、場所、URLなど" rows={3} style={{ ...iSt, resize: "vertical", marginBottom: 14 }} />
          <a href={gcalLink} target="_blank" rel="noreferrer" style={{
            display: "block", textAlign: "center", padding: "14px",
            background: `${C.accent}22`, border: `1.5px solid ${C.accent}`,
            borderRadius: 12, color: C.accent, textDecoration: "none", fontSize: 14, fontWeight: 700,
            boxShadow: `0 0 16px ${C.accent}33`,
          }}>
            📅 Googleカレンダーで予定を作成 →
          </a>
          <p style={{ color: C.muted, fontSize: 11, textAlign: "center", marginTop: 8 }}>リンクを開くとGoogleカレンダーの予定作成画面が開きます</p>
        </Card>
      )}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────
function Page({ children }) {
  return <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Noto Sans JP', sans-serif" }}>{children}</div>;
}
function Card({ children, style = {} }) {
  return <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "18px 16px", ...style }}>{children}</div>;
}
function NBtn({ children, color, onClick, loading, full, style = {} }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ padding: "13px 20px", background: color, border: "none", borderRadius: 12, color: "#fff", cursor: loading ? "wait" : "pointer", fontSize: 14, fontWeight: 800, boxShadow: `0 0 18px ${color}55`, width: full ? "100%" : "auto", transition: "opacity 0.2s", ...style }}>
      {children}
    </button>
  );
}
function BackBtn({ onClick }) {
  return <button onClick={onClick} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, padding: "0 0 16px", display: "flex", alignItems: "center", gap: 4 }}>← 戻る</button>;
}
function BackStep({ onClick }) {
  return <button onClick={onClick} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, padding: "4px 0", display: "block" }}>← 前のステップへ</button>;
}
function SecTitle({ children, color }) {
  return <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.text, borderLeft: `3px solid ${color}`, paddingLeft: 10, fontFamily: "monospace" }}>{children}</h2>;
}
function RoomBadge({ id }) {
  return <span style={{ background: `${C.gold}18`, border: `1px solid ${C.gold}55`, borderRadius: 6, padding: "3px 8px", fontSize: 12, color: C.gold, fontFamily: "monospace", fontWeight: 900, letterSpacing: "2px" }}>{id}</span>;
}
function FieldLabel({ children }) {
  return <label style={{ display: "block", fontSize: 10, color: C.muted, marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>{children}</label>;
}
function DurChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "7px 13px", borderRadius: 20, border: `1.5px solid ${active ? C.accent : C.border}`, background: active ? `${C.accent}22` : C.surfaceHigh, color: active ? C.accent : C.muted, cursor: "pointer", fontSize: 12, fontWeight: active ? 800 : 400, transition: "all 0.15s", boxShadow: active ? `0 0 10px ${C.accent}44` : "none" }}>
      {label}
    </button>
  );
}
function ErrBox({ msg }) {
  return <div style={{ background: `${C.accent2}15`, border: `1px solid ${C.accent2}55`, borderRadius: 8, padding: "10px 14px", color: C.accent2, fontSize: 12, marginTop: 10 }}>⚠ {msg}</div>;
}
const iSt = { width: "100%", padding: "10px 12px", borderRadius: 8, background: C.surfaceHigh, border: `1.5px solid ${C.border}`, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box" };
function GlobalStyle() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;900&display=swap');
    * { box-sizing: border-box; }
    input, textarea, button, a { font-family: 'Noto Sans JP', sans-serif; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
  `}</style>;
}
