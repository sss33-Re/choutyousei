import { useState, useEffect, useCallback } from "react";

const C = {
  bg: "#040d1c", surface: "#0a1626", surfaceHigh: "#13243c",
  border: "#3a5a7e", accent: "#00e5ff", accent2: "#ff6b85",
  gold: "#ffd166", green: "#06ffa5", purple: "#c4a4ff",
  text: "#ffffff", muted: "#9ab4cc", mutedLight: "#c8dcec",
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

// ─── 主催ルーム履歴 ────────────────────────────────────────────
// ルーム名(roomName)はルームデータ本体（共有ストレージ）に保存するので、
// どの端末から開いても同じ名前が見える。
// 「自分が過去にアクセスしたルームID一覧」だけは端末ローカルに保持。
const HISTORY_KEY = "schedsync_host_history";
function loadLocalRoomIds() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveLocalRoomIds(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {}
}
function rememberRoomId(roomId) {
  const list = loadLocalRoomIds().filter(id => id !== roomId);
  list.unshift(roomId);
  saveLocalRoomIds(list.slice(0, 20));
}
function forgetRoomId(roomId) {
  saveLocalRoomIds(loadLocalRoomIds().filter(id => id !== roomId));
}
// 共有ストレージ上のルーム名を更新
async function renameRoom(roomId, roomName) {
  const data = await loadRoom(roomId);
  if (!data) return false;
  data.roomName = roomName;
  await saveRoom(roomId, data);
  return true;
}
// ローカルに覚えているID一覧 → 各ルームの最新データ（名前など）を取得して履歴表示用に整形
async function buildRoomHistory() {
  const ids = loadLocalRoomIds();
  const items = [];
  for (const id of ids) {
    const data = await loadRoom(id);
    if (data) items.push({ roomId: id, roomName: data.roomName || "" });
    else forgetRoomId(id); // 削除済みルームは履歴からも消す
  }
  return items;
}

// ─── Slot computation（連続した空きブロックを算出）─────────────
// 戻り値: 「durationMin以上、空いている連続区間」のリスト（重複スライドなし）
function computeFreeSlots(events, startDate, endDate, durationMin, timeFrom, timeTo, excludeDays = []) {
  const dur = durationMin * 60 * 1000;
  const step = 15 * 60 * 1000; // 境界は15分単位に揃える

  const rangeStart = new Date(startDate instanceof Date ? startDate : parseLocal(startDate));
  const rangeEnd   = new Date(endDate   instanceof Date ? endDate   : parseLocal(endDate));

  const busy = events
    .map(e => ({ s: parseLocal(e.start), e: parseLocal(e.end) }))
    .sort((a, b) => a.s - b.s);

  const [fromH, fromM] = timeFrom ? timeFrom.split(":").map(Number) : [0, 0];
  const [toH, toM]     = timeTo   ? timeTo.split(":").map(Number)   : [23, 59];

  // 日付ごとに「許可された時間帯（曜日・time-of-dayフィルタ後）」の区間リストを作る
  const dayWindows = [];
  let dayCursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const lastDay = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  while (dayCursor <= lastDay) {
    if (!excludeDays.includes(dayCursor.getDay())) {
      const winStart = new Date(dayCursor); winStart.setHours(fromH, fromM, 0, 0);
      const winEnd   = new Date(dayCursor); winEnd.setHours(toH, toM, 0, 0);
      // 全体の範囲(rangeStart〜rangeEnd)でクリップ
      const s = new Date(Math.max(+winStart, +rangeStart));
      const e = new Date(Math.min(+winEnd, +rangeEnd));
      if (s < e) dayWindows.push({ s, e });
    }
    dayCursor = addDays(dayCursor, 1);
  }

  // 各日の許可区間からbusyを切り出して、残りの連続空き区間を求める
  const freeBlocks = [];
  for (const win of dayWindows) {
    let segStart = new Date(win.s);
    // この日の範囲に重なるbusyだけ抽出してソート
    const dayBusy = busy.filter(b => b.s < win.e && b.e > win.s)
      .map(b => ({ s: new Date(Math.max(+b.s, +win.s)), e: new Date(Math.min(+b.e, +win.e)) }))
      .sort((a, b) => a.s - b.s);

    for (const b of dayBusy) {
      if (b.s > segStart) {
        freeBlocks.push({ start: new Date(segStart), end: new Date(b.s) });
      }
      if (b.e > segStart) segStart = new Date(b.e);
    }
    if (segStart < win.e) freeBlocks.push({ start: new Date(segStart), end: new Date(win.e) });
  }

  // durationMin未満のブロックは除外し、境界を15分単位に丸める
  return freeBlocks
    .map(b => {
      const s = new Date(Math.ceil(b.start.getTime() / step) * step);
      const e = new Date(Math.floor(b.end.getTime() / step) * step);
      return { start: s, end: e };
    })
    .filter(b => b.end - b.start >= dur);
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

function makeGCalLink(title, start, end, desc = "", attendees = []) {
  const f = d => (d instanceof Date ? d : parseLocal(d)).toISOString().replace(/[-:]/g, "").replace(".000", "");
  const base = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(start)}/${f(end)}&details=${encodeURIComponent(desc)}`;
  const validEmails = attendees.filter(e => e && e.includes("@"));
  return validEmails.length > 0 ? `${base}&add=${validEmails.map(encodeURIComponent).join(",")}` : base;
}

// ─── Parser ───────────────────────────────────────────────────────
function parseScheduleText(text, startDate) {
  const year = parseLocal(startDate).getFullYear();
  const events = [];
  for (const line of text.split("\n").map(l => l.trim()).filter(Boolean)) {
    // 終日予定パターン: "6/5（木）終日 タイトル" 等の表記ゆれに対応
    const allDay = line.match(/(\d{1,2})[\/月]\s*(\d{1,2})\s*[日（\(]?\s*[月火水木金土日]?\s*[）\)]?\s*終日\s*(.*)/);
    if (allDay) {
      const [, month, day, title] = allDay;
      events.push({
        title: (title || "終日の予定").trim(),
        start: localISO(year, Number(month), Number(day), 0, 0),
        end:   localISO(year, Number(month), Number(day), 23, 59),
        allDay: true,
      });
      continue;
    }
    // 通常パターン: "6/5（木）10:00〜11:00 タイトル"
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
  return `私のGoogleカレンダーの予定を${startDate}から${endDate}まで全て教えてください。\n\n必ず以下の形式で1行ずつ出力してください（この形式以外は使わないでください）：\n・時間が決まっている予定: 月/日（曜日）HH:MM〜HH:MM タイトル\n・終日の予定: 月/日（曜日）終日 タイトル\n\n出力例：\n6/5（木）10:00〜11:00 チームMTG\n6/6（金）終日 出張\n6/7（土）14:00〜15:00 クライアント面談\n\n予定がない場合は「予定なし」とだけ出力してください。表形式や箇条書きは使わないでください。`;
}

// ─── App ──────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("top");
  const [roomId, setRoomId] = useState(null);
  const [joinInput, setJoinInput] = useState("");
  const [manageInput, setManageInput] = useState("");

  return (
    <Page>
      {screen === "top" && <TopScreen
        onCreate={async () => {
          const id = genRoomId();
          await saveRoom(id, { id, roomName: "", submissions: [], createdAt: new Date().toISOString() });
          rememberRoomId(id);
          setRoomId(id); setScreen("host");
        }}
        onJoin={() => setScreen("join")}
        onManage={() => setScreen("manage")}
      />}
      {screen === "join" && <JoinScreen
        title="🔑 ルームに参加" color={C.gold} buttonLabel="参加する →"
        value={joinInput} onChange={setJoinInput}
        onBack={() => setScreen("top")}
        onJoin={async () => {
          const id = joinInput.trim().toUpperCase();
          const data = await loadRoom(id);
          if (!data) { alert("ルームが見つかりません。IDを確認してください。"); return; }
          setRoomId(id); setScreen("member");
        }}
      />}
      {screen === "manage" && <JoinScreen
        title="👑 主催者として再開" color={C.accent} buttonLabel="このルームを開く →"
        value={manageInput} onChange={setManageInput}
        onBack={() => setScreen("top")}
        showHistory
        onJoin={async (overrideId) => {
          const id = (overrideId || manageInput).trim().toUpperCase();
          const data = await loadRoom(id);
          if (!data) { alert("ルームが見つかりません。IDを確認してください。"); return; }
          rememberRoomId(id);
          setRoomId(id); setScreen("host");
        }}
      />}
      {screen === "member" && <MemberScreen roomId={roomId} onBack={() => setScreen("top")} />}
      {screen === "host"   && <HostScreen   roomId={roomId} onBack={() => setScreen("top")} />}
      <GlobalStyle />
    </Page>
  );
}

// ─── TOP ─────────────────────────────────────────────────────────
function TopScreen({ onCreate, onJoin, onManage }) {
  const [previewId, setPreviewId] = useState("");
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchPreview = async (id) => {
    const clean = id.trim().toUpperCase();
    setPreviewId(clean);
    if (clean.length < 6) { setPreviewData(null); return; }
    setPreviewLoading(true);
    const data = await loadRoom(clean);
    setPreviewData(data || null);
    setPreviewLoading(false);
  };

  const finalized = previewData?.finalizedEvent;

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "40px 20px 32px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
      <h1 style={{ margin: "0 0 6px", fontSize: 30, fontWeight: 900, letterSpacing: "-2px", fontFamily: "monospace" }}>
        <span style={{ color: C.accent }}>SCHED</span><span style={{ color: C.text }}>SYNC</span>
      </h1>
      <p style={{ margin: "0 0 28px", color: C.muted, fontSize: 14 }}>予定テキスト貼り付け → 全員の空き時間を自動算出</p>

      {/* ルームIDで確定情報を確認 */}
      <div style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "16px", marginBottom: 20, textAlign: "left" }}>
        <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "#c8d4e0" }}>🔍 ルームIDで予定を確認</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={previewId} onChange={e => fetchPreview(e.target.value)} placeholder="ルームID（6文字）" maxLength={6}
            style={{ ...iSt, flex: 1, textAlign: "center", fontSize: 20, letterSpacing: "6px", fontWeight: 900, color: "#ffffff" }} />
        </div>

        {previewLoading && <p style={{ color: C.muted, fontSize: 13, margin: "10px 0 0", textAlign: "center" }}>読み込み中…</p>}

        {previewData && !previewLoading && (
          <div style={{ marginTop: 12 }}>
            {previewData.roomName && (
              <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 800, color: "#ffffff" }}>📌 {previewData.roomName}</p>
            )}
            {finalized ? (
              <div style={{ background: "#0a1f18", border: `2px solid ${C.green}`, borderRadius: 12, padding: "14px" }}>
                <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 900, color: "#5dffc0" }}>✅ 予定が確定しています</p>
                <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: "#ffffff" }}>{finalized.title}</p>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#c8d4e0" }}>
                  {fmtDate(finalized.start)} {fmtTime(finalized.start)} 〜 {fmtTime(finalized.end)}
                </p>
                <a href={makeGCalLink(finalized.title, parseLocal(finalized.start), parseLocal(finalized.end), finalized.desc || "")}
                  target="_blank" rel="noreferrer" style={{
                    display: "block", textAlign: "center", padding: "12px",
                    background: "#eef4fb", border: `2px solid ${C.green}`, borderRadius: 10,
                    color: "#0a1220", textDecoration: "none", fontSize: 14, fontWeight: 800,
                    boxShadow: `0 0 12px ${C.green}55`,
                  }}>
                  📅 自分のGoogleカレンダーに追加 →
                </a>
              </div>
            ) : (
              <p style={{ color: "#9ab4cc", fontSize: 13, textAlign: "center", padding: "8px 0" }}>
                {previewData.submissions?.length > 0
                  ? `${previewData.submissions.length}名が送信済み・まだ確定していません`
                  : "まだ誰も送信していません"}
              </p>
            )}
          </div>
        )}

        {previewId.length === 6 && !previewLoading && !previewData && (
          <p style={{ color: C.accent2, fontSize: 13, margin: "10px 0 0", textAlign: "center" }}>⚠ ルームが見つかりません</p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ModeBtn color={C.accent} emoji="✨" title="ルームを作成する" desc="主催者として部屋を作り、参加者にIDを共有する" onClick={onCreate} />
        <ModeBtn color={C.gold}   emoji="🔑" title="ルームに参加する" desc="主催者から届いたルームIDを入力して参加する"    onClick={onJoin}  />
        <button onClick={onManage} style={{
          background: `${C.gold}14`, border: `1.5px solid ${C.gold}77`, color: "#ffffff",
          cursor: "pointer", fontSize: 14, fontWeight: 800, marginTop: 6,
          padding: "12px 16px", borderRadius: 12, transition: "all 0.2s",
          boxShadow: `0 0 10px ${C.gold}22`,
        }}>
          <span style={{ color: C.gold }}>🔁</span> すでに作成したルームの主催者ビューに戻る
        </button>
      </div>
    </div>
  );
}
function ModeBtn({ color, emoji, title, desc, onClick }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? `${color}22` : "#13203a", border: `2px solid ${h ? color : color+"99"}`, borderRadius: 16, padding: "20px 18px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", boxShadow: h ? `0 0 28px ${color}55` : `0 0 8px ${color}22`, display: "flex", gap: 14, alignItems: "flex-start", width: "100%" }}>
      <span style={{ fontSize: 26 }}>{emoji}</span>
      <div>
        <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#ffffff" }}>{title}</p>
        <p style={{ margin: 0, fontSize: 13, color: "#b8c8d8", lineHeight: 1.5 }}>{desc}</p>
      </div>
    </button>
  );
}

// ─── JOIN / MANAGE（共通コンポーネント）────────────────────────────
function JoinScreen({ value, onChange, onJoin, onBack, title = "🔑 ルームに参加", color = C.gold, buttonLabel = "参加する →", showHistory = false }) {
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(showHistory);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const refreshHistory = useCallback(async () => {
    if (!showHistory) return;
    setHistoryLoading(true);
    const items = await buildRoomHistory();
    setHistory(items);
    setHistoryLoading(false);
  }, [showHistory]);

  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  const startEdit = (r) => { setEditingId(r.roomId); setEditName(r.roomName || ""); };
  const saveEdit = async () => {
    setSavingEdit(true);
    await renameRoom(editingId, editName.trim());
    setEditingId(null);
    setSavingEdit(false);
    refreshHistory();
  };
  const deleteEntry = (roomId) => {
    forgetRoomId(roomId);
    setHistory(h => h.filter(r => r.roomId !== roomId));
  };

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "24px 20px" }}>
      <BackBtn onClick={onBack} />
      <SecTitle color={color}>{title}</SecTitle>
      <Card>
        <FieldLabel>ルームID（6文字）</FieldLabel>
        <input value={value} onChange={e => onChange(e.target.value.toUpperCase())} placeholder="例：AB12CD" maxLength={6}
          style={{ ...iSt, textAlign: "center", fontSize: 28, letterSpacing: "10px", fontWeight: 900, color: "#ffffff", marginBottom: 14 }} />
        <NBtn color={color} onClick={() => onJoin()} full>{buttonLabel}</NBtn>
      </Card>

      {showHistory && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: "#e8f4ff", marginBottom: 10 }}>📂 これまでのルーム履歴</p>
          {historyLoading ? (
            <p style={{ color: "#9aa8ba", fontSize: 14, textAlign: "center", padding: "16px 0" }}>読み込み中…</p>
          ) : history.length === 0 ? (
            <p style={{ color: "#9aa8ba", fontSize: 14, textAlign: "center", padding: "16px 0" }}>まだ履歴がありません</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map(r => (
                <div key={r.roomId} style={{
                  background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "12px 14px",
                }}>
                  {editingId === r.roomId ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="ルームの名前（例：6月の飲み会）"
                        autoFocus
                        style={{ ...iSt, flex: 1, fontSize: 14, color: "#ffffff" }} />
                      <button onClick={saveEdit} disabled={savingEdit} style={{
                        background: "#e3faf0", border: `2px solid ${C.green}`, borderRadius: 8,
                        color: "#0a4a30", fontWeight: 800, fontSize: 13, padding: "8px 12px", cursor: savingEdit ? "wait" : "pointer",
                      }}>{savingEdit ? "…" : "✓ 保存"}</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ flex: 1, cursor: "pointer" }} onClick={() => onJoin(r.roomId)}>
                        <p style={{ margin: "0 0 3px", fontSize: 15, fontWeight: 800, color: "#ffffff" }}>
                          {r.roomName || "（名前未設定）"}
                        </p>
                        <p style={{ margin: 0, fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: color, letterSpacing: "2px" }}>
                          {r.roomId}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => startEdit(r)} style={{
                          background: "#eef4fb", border: `2px solid ${C.accent}`, borderRadius: 8,
                          color: "#0a1220", fontWeight: 800, fontSize: 12, padding: "7px 10px", cursor: "pointer",
                        }}>✏️ 名前</button>
                        <button onClick={() => deleteEntry(r.roomId)} style={{
                          background: "#fde8ea", border: `2px solid ${C.accent2}`, borderRadius: 8,
                          color: "#7a1020", fontWeight: 800, fontSize: 12, padding: "7px 10px", cursor: "pointer",
                        }}>🗑</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MEMBER ───────────────────────────────────────────────────────
function MemberScreen({ roomId, onBack }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roomData, setRoomData] = useState(null);
  // 条件はルームから取得（主催者が設定したもの）
  const [startDate, setStartDate] = useState(() => todayStr());
  const [endDate,   setEndDate]   = useState(() => fmt(addDays(new Date(), 14)));
  const [duration,  setDuration]  = useState(60);
  const [timeFrom,  setTimeFrom]  = useState("");
  const [timeTo,    setTimeTo]    = useState("");
  const [excludeDays, setExcludeDays] = useState([]);
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
      if (data.excludeDays) setExcludeDays(data.excludeDays);
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

  const [busyEvents, setBusyEvents] = useState([]);

  const analyze = () => {
    if (!pastedText.trim()) { setError("予定テキストを貼り付けてください"); return; }
    setError(null);
    try {
      const events = parseScheduleText(pastedText, startDate);
      const slots = computeFreeSlots(events, startDate, endDate, duration, timeFrom || null, timeTo || null, excludeDays);
      setBusyEvents(events);
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
        email: email.trim(),
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <SecTitle color={C.accent}>👤 空き時間を送信</SecTitle>
        <RoomBadge id={roomId} />
      </div>
      {roomData?.roomName && (
        <p style={{ color: "#c8d4e0", fontSize: 14, fontWeight: 700, margin: "0 0 16px" }}>📌 {roomData.roomName}</p>
      )}

      <button onClick={() => loadRoom(roomId).then(d => d && setRoomData(d))} style={{
        background: "#eef4fb", border: `2px solid ${C.accent}`, borderRadius: 8, padding: "7px 14px",
        color: "#0a1220", cursor: "pointer", fontSize: 12, fontWeight: 800, marginBottom: 14,
        boxShadow: `0 0 8px ${C.accent}44`,
      }}>
        🔄 確定情報を更新する
      </button>

      {/* 確定済みの予定があれば表示 */}
      {roomData?.finalizedEvent && (
        <Card style={{ borderColor: C.green, marginBottom: 18, background: "#0a1f18" }}>
          <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 900, color: "#5dffc0" }}>✅ 予定が確定しました！</p>
          <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: "#ffffff" }}>{roomData.finalizedEvent.title}</p>
          <p style={{ margin: "0 0 14px", fontSize: 14, color: "#c8d4e0" }}>
            {fmtDate(roomData.finalizedEvent.start)} {fmtTime(roomData.finalizedEvent.start)} 〜 {fmtTime(roomData.finalizedEvent.end)}
          </p>
          <a href={makeGCalLink(roomData.finalizedEvent.title, parseLocal(roomData.finalizedEvent.start), parseLocal(roomData.finalizedEvent.end), roomData.finalizedEvent.desc || "")}
            target="_blank" rel="noreferrer" style={{
              display: "block", textAlign: "center", padding: "13px",
              background: "#eef4fb", border: `2px solid ${C.green}`,
              borderRadius: 12, color: "#0a1220", textDecoration: "none", fontSize: 14, fontWeight: 800,
              boxShadow: `0 0 16px ${C.green}66`,
            }}>
            📅 自分のGoogleカレンダーに追加 →
          </a>
        </Card>
      )}

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 24 }}>
        {[1,2,3,4].map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
              background: step > s ? C.green : step === s ? C.accent : C.surfaceHigh,
              color: step >= s ? C.bg : C.muted,
              border: `2px solid ${step > s ? C.green : step === s ? C.accent : C.border}`,
              boxShadow: step === s ? `0 0 14px ${C.accent}88` : "none", transition: "all 0.3s",
            }}>{step > s ? "✓" : s}</div>
            {i < 3 && <div style={{ width: 18, height: 2, background: step > s ? C.green : C.border, borderRadius: 1 }} />}
          </div>
        ))}
        <span style={{ color: C.mutedLight, fontSize: 12, marginLeft: 8 }}>
          {["設定", "Claudeへ", "貼り付け", "編集・送信"][Math.min(step,4)-1]}
        </span>
      </div>

      {/* STEP 5: 完了 */}
      {step === 5 && (
        <Card style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
          <p style={{ fontSize: 21, fontWeight: 900, color: C.green, margin: "0 0 8px" }}>送信完了！</p>
          <p style={{ color: C.mutedLight, fontSize: 14, margin: "0 0 4px" }}>{name} さんの空き時間</p>
          <p style={{ color: C.accent, fontWeight: 900, fontSize: 32, margin: 0 }}>{enabledCount}<span style={{ fontSize: 15, fontWeight: 400 }}>件</span></p>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 20, lineHeight: 1.7 }}>主催者がルーム画面を更新すると<br />あなたの空き時間が反映されます</p>
          <NBtn color={C.muted} onClick={onBack} full style={{ marginTop: 20, background: "#e2e8f0", color: "#1a1a1a", boxShadow: "none", border: `2px solid ${C.border}` }}>トップに戻る</NBtn>
        </Card>
      )}

      {/* STEP 1: 設定 */}
      {step === 1 && (
        <Card>
          {hasConditions && (
            <div style={{ background: `${C.gold}11`, border: `1px solid ${C.gold}44`, borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: C.gold, fontWeight: 700 }}>👑 主催者の設定条件</p>
              <p style={{ margin: 0, fontSize: 13, color: C.mutedLight, lineHeight: 1.6 }}>
                {roomData.startDate && `期間: ${fmtDate(roomData.startDate)} 〜 ${fmtDate(roomData.endDate)}`}
                {roomData.timeFrom && `　時間帯: ${roomData.timeFrom} 〜 ${roomData.timeTo}`}
                {roomData.excludeDays?.length > 0 && `　対象外: ${roomData.excludeDays.map(d => ["日","月","火","水","木","金","土"][d]).join("・")}曜`}
              </p>
            </div>
          )}
          <FieldLabel>あなたの名前</FieldLabel>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：田中 太郎" style={{ ...iSt, marginBottom: 10 }} />
          <FieldLabel>メールアドレス（Googleアカウント・任意）</FieldLabel>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="例：taro@gmail.com" type="email"
            style={{ ...iSt, marginBottom: 14 }} />
          <p style={{ color: "#9ab4cc", fontSize: 11, margin: "-10px 0 14px", lineHeight: 1.5 }}>
            入力すると主催者がGoogleカレンダーで予定を作成する際に自動で招待されます
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <CalendarPicker label="開始日時" value={startDate} onChange={setStartDate} />
            <CalendarPicker label="終了日時" value={endDate} onChange={setEndDate} />
          </div>
          <FieldLabel>必要な空き時間</FieldLabel>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {DURATION_OPTIONS.map(o => <DurChip key={o.value} label={o.label} active={duration === o.value} onClick={() => setDuration(o.value)} />)}
          </div>
          {(timeFrom || timeTo) && (
            <div style={{ background: `${C.accent}11`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "8px 12px", marginBottom: 4 }}>
              <p style={{ margin: 0, fontSize: 13, color: C.accent }}>🕐 時間帯フィルタ：{timeFrom} 〜 {timeTo} の枠のみ算出</p>
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
            <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: C.purple }}>📋 Claudeのチャットで予定を取得する</p>
            <p style={{ color: C.mutedLight, fontSize: 14, lineHeight: 1.7, margin: "0 0 14px" }}>
              下のプロンプトをコピーして、<strong style={{ color: C.text }}>Claudeのチャット画面</strong>に貼り付けてください。
            </p>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 14, color: C.text, lineHeight: 1.7, userSelect: "all", whiteSpace: "pre-wrap" }}>{prompt}</div>
            <button onClick={copyPrompt} style={{
              width: "100%", padding: "13px", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 800, transition: "all 0.2s", border: "2px solid",
              background: copyState === "copied" ? "#e3faf0" : copyState === "error" ? "#fde8ea" : "#f0eafd",
              borderColor: copyState === "copied" ? C.green : copyState === "error" ? C.accent2 : C.purple,
              color: copyState === "copied" ? "#0a4a30" : copyState === "error" ? "#7a1020" : "#3a1a7a",
              boxShadow: `0 0 10px ${copyState === "copied" ? C.green : copyState === "error" ? C.accent2 : C.purple}44`,
            }}>
              {copyState === "copied" ? "✓ コピーしました！" : copyState === "error" ? "⚠ 手動で長押しコピーしてください" : "📋 プロンプトをコピー"}
            </button>
          </Card>
          <Card>
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: C.gold }}>手順</p>
            {["Claudeのチャット画面を新しく開く", "プロンプトを貼り付けて送信", "Claudeが返した予定一覧をコピー", "このアプリに戻って「次へ」を押す"].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
                <span style={{ color: C.gold, fontWeight: 900, fontSize: 14, minWidth: 16 }}>{i+1}</span>
                <span style={{ color: C.mutedLight, fontSize: 14, lineHeight: 1.5 }}>{t}</span>
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
            <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 800, color: C.accent }}>📝 Claudeの返答を貼り付け</p>
            <p style={{ color: C.mutedLight, fontSize: 14, margin: "0 0 12px", lineHeight: 1.6 }}>
              ClaudeがGoogleカレンダーの予定を返答したテキストをそのまま貼り付けてください。
            </p>
            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)}
              placeholder={"例：\n6/5（木）10:00〜11:00 チームMTG\n6/6（金）14:00〜15:00 クライアント面談"}
              rows={10} style={{ ...iSt, resize: "vertical", fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 }} />
            {error && <ErrBox msg={error} />}
          </Card>
          <NBtn color={C.accent} onClick={analyze} full>🔍 空き時間を自動算出</NBtn>
          <BackStep onClick={() => setStep(2)} />
        </div>
      )}

      {/* STEP 4: 編集・送信（カレンダー風グリッド表示） */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.green }}>✅ 空き時間を確認・編集</p>
              <span style={{ color: C.accent, fontWeight: 900, fontSize: 17 }}>{enabledCount}<span style={{ fontSize: 12, color: C.mutedLight, fontWeight: 400 }}>/{freeSlots.length}件</span></span>
            </div>
            <p style={{ color: "#c8d4e0", fontSize: 13, fontWeight: 600, margin: "0 0 14px", lineHeight: 1.6 }}>
              <span style={{ color: "#5dffc0" }}>■</span>空き（タップで送信対象から外せます）　
              <span style={{ color: "#8a96a8" }}>■</span>予定あり／対象外
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => setFreeSlots(p => p.map(s => ({ ...s, enabled: true })))}
                style={{ flex: 1, padding: "9px", background: "#e3faf0", border: `2px solid ${C.green}`, borderRadius: 8, color: "#0a4a30", cursor: "pointer", fontSize: 13, fontWeight: 800, boxShadow: `0 0 8px ${C.green}44` }}>
                すべて選択
              </button>
              <button onClick={() => setFreeSlots(p => p.map(s => ({ ...s, enabled: false })))}
                style={{ flex: 1, padding: "9px", background: "#fde8ea", border: `2px solid ${C.accent2}`, borderRadius: 8, color: "#7a1020", cursor: "pointer", fontSize: 13, fontWeight: 800, boxShadow: `0 0 8px ${C.accent2}44` }}>
                すべて解除
              </button>
            </div>

            <DayTimelineGrid
              freeSlots={freeSlots}
              busyEvents={busyEvents}
              startDate={startDate}
              endDate={endDate}
              timeFrom={timeFrom}
              timeTo={timeTo}
              onToggleSlot={toggleSlot}
            />
          </Card>
          <Card>
            <FieldLabel>送信者名の確認</FieldLabel>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="名前" style={{ ...iSt, marginBottom: 4 }} />
          </Card>
          {error && <ErrBox msg={error} />}
          <NBtn color={C.green} onClick={submit} loading={loading} full>
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
  const [editStartTime, setEditStartTime] = useState(""); // "HH:MM"
  const [editEndTime,   setEditEndTime]   = useState(""); // "HH:MM"
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [copied, setCopied] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomNameSaving, setRoomNameSaving] = useState(false);
  const [roomNameSaved, setRoomNameSaved] = useState(false);
  const [finalizedSaved, setFinalizedSaved] = useState(false);

  // 候補日を選んだ時、その枠の時刻で時刻編集欄を初期化
  const selectSlot = (slot) => {
    setSelected(slot);
    setEditStartTime(`${pad(slot.start.getHours())}:${pad(slot.start.getMinutes())}`);
    setEditEndTime(`${pad(slot.end.getHours())}:${pad(slot.end.getMinutes())}`);
  };

  // 編集後の実際の開始・終了Date（同じ日付のまま時刻だけ変える）
  const editedRange = (() => {
    if (!selected || !editStartTime || !editEndTime) return null;
    const base = selected.start;
    const [sh, sm] = editStartTime.split(":").map(Number);
    const [eh, em] = editEndTime.split(":").map(Number);
    const s = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm);
    const e = new Date(base.getFullYear(), base.getMonth(), base.getDate(), eh, em);
    return { start: s, end: e };
  })();

  // 15分刻みの時刻選択肢（候補ブロックの範囲内のみ）
  const timeOptionsFor = (slot) => {
    if (!slot) return [];
    const opts = [];
    let t = new Date(slot.start);
    while (t <= slot.end) {
      opts.push(`${pad(t.getHours())}:${pad(t.getMinutes())}`);
      t = new Date(t.getTime() + 15 * 60 * 1000);
    }
    return opts;
  };

  // 主催者が設定する条件
  const [condStart,    setCondStart]    = useState(() => todayStr());
  const [condEnd,      setCondEnd]      = useState(() => fmt(addDays(new Date(), 14)));
  const [condDuration, setCondDuration] = useState(60);
  const [condTimeFrom, setCondTimeFrom] = useState("");
  const [condTimeTo,   setCondTimeTo]   = useState("");
  const [condExcludeDays, setCondExcludeDays] = useState([]); // [0,6] = 日・土を除外
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
    if (data?.excludeDays) setCondExcludeDays(data.excludeDays);
    if (data?.startDate)  setCondSaved(true);
    setRoomName(data?.roomName || "");
    setLoading(false);
  }, [roomId]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleExcludeDay = (d) => {
    setCondExcludeDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  };

  const saveRoomName = async () => {
    setRoomNameSaving(true);
    await renameRoom(roomId, roomName.trim());
    setRoomNameSaving(false);
    setRoomNameSaved(true);
    setTimeout(() => setRoomNameSaved(false), 2000);
  };

  const saveConditions = async () => {
    const data = await loadRoom(roomId);
    if (!data) return;
    Object.assign(data, { startDate: condStart, endDate: condEnd, duration: condDuration, timeFrom: condTimeFrom, timeTo: condTimeTo, excludeDays: condExcludeDays });
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
    // 時間帯・曜日フィルタを共通スロットにも適用
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
    if (condExcludeDays.length) {
      common = common.filter(s => !condExcludeDays.includes(s.start.getDay()));
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

  // 参加者のメアドを自動で招待に含める
  const attendeeEmails = (room?.submissions || []).map(s => s.email).filter(e => e && e.includes("@"));
  const gcalLink = editedRange ? makeGCalLink(title || "ミーティング", editedRange.start, editedRange.end, desc, attendeeEmails) : null;

  // 確定した予定をルームデータに保存（参加者にも見えるようにする）
  const finalizeEvent = async () => {
    if (!editedRange || editedRange.end <= editedRange.start) return;
    const data = await loadRoom(roomId);
    if (!data) return;
    data.finalizedEvent = {
      title: title || "ミーティング",
      desc,
      start: fmt(editedRange.start),
      end: fmt(editedRange.end),
      decidedAt: new Date().toISOString(),
    };
    await saveRoom(roomId, data);
    setRoom(data);
    setFinalizedSaved(true);
    setTimeout(() => setFinalizedSaved(false), 3000);
  };
  const subs = room?.submissions || [];

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px" }}>
      <BackBtn onClick={onBack} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <SecTitle color={C.gold}>👑 主催者ビュー</SecTitle>
        <RoomBadge id={roomId} />
      </div>

      {/* ルーム名 */}
      <Card style={{ borderColor: `${C.gold}44`, marginBottom: 14 }}>
        <FieldLabel>ルーム名（参加者にも表示されます）</FieldLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="例：6月の飲み会、Aチーム定例MTG"
            style={{ ...iSt, flex: 1, color: "#ffffff" }} />
          <button onClick={saveRoomName} disabled={roomNameSaving} style={{
            background: roomNameSaved ? "#e3faf0" : "#fdf3da",
            border: `2px solid ${roomNameSaved ? C.green : C.gold}`, borderRadius: 8, padding: "0 16px",
            color: roomNameSaved ? "#0a4a30" : "#5a4500", cursor: roomNameSaving ? "wait" : "pointer",
            fontWeight: 800, fontSize: 13, whiteSpace: "nowrap",
          }}>
            {roomNameSaved ? "✓ 保存済" : roomNameSaving ? "…" : "保存"}
          </button>
        </div>
      </Card>

      {/* 条件設定 */}
      <Card style={{ borderColor: `${C.accent}44`, marginBottom: 14 }}>
        <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: C.accent }}>⚙️ 募集条件を設定する</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <CalendarPicker label="開始日時" value={condStart} onChange={setCondStart} />
          <CalendarPicker label="終了日時" value={condEnd} onChange={setCondEnd} />
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
        <FieldLabel>対象外の曜日（任意）</FieldLabel>
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          {["日","月","火","水","木","金","土"].map((d, i) => {
            const active = condExcludeDays.includes(i);
            return (
              <button key={i} onClick={() => toggleExcludeDay(i)} style={{
                flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer",
                border: `2px solid ${active ? C.accent2 : "#3a4a5c"}`,
                background: active ? "#fde8ea" : "#1a2638",
                color: active ? "#7a1020" : "#c8d4e0",
                fontSize: 13, fontWeight: active ? 800 : 600,
                textDecoration: active ? "line-through" : "none",
                transition: "all 0.15s",
                boxShadow: active ? `0 0 10px ${C.accent2}55` : "none",
              }}>{d}</button>
            );
          })}
        </div>
        <p style={{ color: C.muted, fontSize: 12, margin: "6px 0 14px" }}>タップした曜日は候補から除外されます</p>
        <NBtn color={C.accent} onClick={saveConditions} full>
          💾 条件を保存して参加者に反映
        </NBtn>
        {condSaved && <p style={{ color: C.green, fontSize: 13, textAlign: "center", marginTop: 8 }}>✓ 保存済み・参加者の画面に反映されます</p>}
      </Card>

      {/* 共有 */}
      <Card style={{ borderColor: `${C.gold}44`, marginBottom: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: C.gold }}>📤 参加者に共有する</p>
        <div style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "1px" }}>Room ID</p>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 900, color: C.gold, letterSpacing: "6px", fontFamily: "monospace" }}>{roomId}</p>
          </div>
          <button onClick={copyShare} style={{
            background: copied ? "#e3faf0" : "#fdf3da",
            border: `2px solid ${copied ? C.green : C.gold}`, borderRadius: 8, padding: "9px 16px",
            color: copied ? "#0a4a30" : "#5a4500", cursor: "pointer", fontSize: 13, fontWeight: 800,
            boxShadow: `0 0 10px ${copied ? C.green : C.gold}55`,
          }}>
            {copied ? "✓ コピー済" : "📋 共有文をコピー"}
          </button>
        </div>
      </Card>

      {/* 送信済み一覧 */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
            送信済み <span style={{ color: C.accent, fontSize: 21, fontWeight: 900 }}>{subs.length}</span> 名
          </p>
          <button onClick={refresh} style={{
            background: "#eef4fb", border: `2px solid ${C.accent}`, borderRadius: 8, padding: "7px 14px",
            color: "#0a1220", cursor: "pointer", fontSize: 13, fontWeight: 800,
            boxShadow: `0 0 8px ${C.accent}44`,
          }}>
            {loading ? "…" : "🔄 更新"}
          </button>
        </div>
        {subs.length === 0
          ? <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "20px 0" }}>まだ誰も送信していません</p>
          : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {subs.map((s, i) => (
                <div key={i} style={{ background: C.bg, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{s.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                      空き時間 {s.slots.length}件　{s.email ? <span style={{ color: "#5dffc0" }}>✉ {s.email}</span> : <span style={{ color: "#9ab4cc" }}>メアドなし</span>}
                    </p>
                  </div>
                  <span style={{ color: C.green, fontSize: 13, fontWeight: 600 }}>✓ 送信済み</span>
                </div>
              ))}
            </div>
        }
      </Card>

      {subs.length >= 2
        ? <NBtn color={C.gold} onClick={compute} full style={{ marginBottom: 14 }}>🔍 全員の共通空き時間を算出</NBtn>
        : <p style={{ color: C.muted, fontSize: 13, textAlign: "center", marginBottom: 14 }}>2名以上の送信が必要です（現在 {subs.length}名）</p>
      }

      {/* 共通スロット（カレンダーグリッド表示） */}
      {computed && (
        <Card style={{ marginBottom: 14 }}>
          <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: commonSlots.length > 0 ? C.green : C.accent2 }}>
            {commonSlots.length > 0 ? `✅ 共通の空き時間 ${commonSlots.length}件` : "❌ 共通の空き時間が見つかりませんでした"}
          </p>
          {commonSlots.length === 0 && <p style={{ color: C.muted, fontSize: 14 }}>期間を広げるか、参加者に再送信してもらいましょう。</p>}
          {commonSlots.length > 0 && (
            <>
              <p style={{ color: "#c8d4e0", fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
                <span style={{ color: "#5dffc0" }}>■</span>候補日　<span style={{ color: "#ffd166" }}>■</span>選択中
              </p>
              <DayTimelineGrid
                freeSlots={commonSlots.map(s => ({ start: s.start, end: s.end }))}
                busyEvents={[]}
                startDate={condStart}
                endDate={condEnd}
                timeFrom={condTimeFrom}
                timeTo={condTimeTo}
                mode="select"
                selectedSlot={selected ? { start: selected.start, end: selected.end } : null}
                onSelectSlot={selectSlot}
              />
            </>
          )}
        </Card>
      )}

      {/* 予定作成 */}
      {selected && (
        <Card style={{ borderColor: `${C.accent}44` }}>
          <p style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: C.accent }}>📝 予定を作成</p>
          <div style={{ background: `${C.accent}11`, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
            <p style={{ margin: 0, fontSize: 14, color: C.accent, fontWeight: 700 }}>
              候補日: {fmtDate(selected.start)}（空き時間 {fmtTime(selected.start)} 〜 {fmtTime(selected.end)}）
            </p>
          </div>
          {attendeeEmails.length > 0 && (
            <div style={{ background: "#0a1f18", border: `1px solid ${C.green}55`, borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 800, color: "#5dffc0" }}>✉ {attendeeEmails.length}名を自動招待</p>
              <p style={{ margin: 0, fontSize: 11, color: "#9ab4cc", wordBreak: "break-all" }}>{attendeeEmails.join("、")}</p>
            </div>
          )}
          {attendeeEmails.length === 0 && (
            <p style={{ color: "#9ab4cc", fontSize: 12, marginBottom: 14 }}>※ 参加者がメアドを登録すると自動で招待されます</p>
          )}

          <FieldLabel>予定の時間を編集（候補日の空き範囲内で調整できます）</FieldLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <select value={editStartTime} onChange={e => setEditStartTime(e.target.value)} style={iSt}>
              {timeOptionsFor(selected).slice(0, -1).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ color: "#c8d4e0", textAlign: "center", fontWeight: 700 }}>〜</span>
            <select value={editEndTime} onChange={e => setEditEndTime(e.target.value)} style={iSt}>
              {timeOptionsFor(selected).slice(1).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {editedRange && editedRange.end <= editedRange.start && (
            <ErrBox msg="終了時刻は開始時刻より後にしてください" />
          )}

          <FieldLabel>イベントタイトル</FieldLabel>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例：チームミーティング" style={{ ...iSt, marginBottom: 12 }} />
          <FieldLabel>説明・場所など（任意）</FieldLabel>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="アジェンダ、場所、URLなど" rows={3} style={{ ...iSt, resize: "vertical", marginBottom: 14 }} />
          <a href={gcalLink} target="_blank" rel="noreferrer"
            onClick={() => finalizeEvent()}
            style={{
              display: "block", textAlign: "center", padding: "15px",
              background: "#eef4fb", border: `2px solid ${C.accent}`,
              borderRadius: 12, color: "#0a1220", textDecoration: "none", fontSize: 15, fontWeight: 800,
              boxShadow: `0 0 18px ${C.accent}66`,
              pointerEvents: (editedRange && editedRange.end <= editedRange.start) ? "none" : "auto",
              opacity: (editedRange && editedRange.end <= editedRange.start) ? 0.5 : 1,
            }}>
            📅 Googleカレンダーで予定を作成 →
          </a>
          <p style={{ color: C.muted, fontSize: 12, textAlign: "center", marginTop: 8 }}>
            リンクを開くとGoogleカレンダーの予定作成画面が開きます。<br />
            同時に確定情報が参加者にも共有され、参加者側でも予定を追加できるようになります。
          </p>
          {finalizedSaved && (
            <p style={{ color: "#5dffc0", fontSize: 13, fontWeight: 700, textAlign: "center", marginTop: 6 }}>✓ 確定情報を参加者に共有しました</p>
          )}
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
    <button onClick={onClick} disabled={loading} style={{
      padding: "13px 20px", background: "#f4f8ff", border: `2px solid ${color}`,
      borderRadius: 12, color: "#0a1220", cursor: loading ? "wait" : "pointer",
      fontSize: 15, fontWeight: 800, boxShadow: `0 0 20px ${color}66, 0 2px 8px rgba(0,0,0,0.3)`,
      width: full ? "100%" : "auto", transition: "all 0.2s", ...style,
    }}>
      {children}
    </button>
  );
}
function BackBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "#eef4fb", border: `2px solid ${C.accent}`, color: "#0a1220",
      cursor: "pointer", fontSize: 14, fontWeight: 800, padding: "9px 16px",
      borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16,
      transition: "all 0.2s", boxShadow: `0 0 10px ${C.accent}55`,
    }}>← 戻る</button>
  );
}
function BackStep({ onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "#eef4fb", border: `2px solid ${C.accent}`, color: "#0a1220",
      cursor: "pointer", fontSize: 13, fontWeight: 800, padding: "9px 16px",
      borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 6,
      transition: "all 0.2s", boxShadow: `0 0 10px ${C.accent}55`,
    }}>← 前のステップへ</button>
  );
}
function SecTitle({ children, color }) {
  return <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900, color: "#ffffff", borderLeft: `4px solid ${color}`, paddingLeft: 10, fontFamily: "monospace" }}>{children}</h2>;
}
function RoomBadge({ id }) {
  return <span style={{ background: `${C.gold}22`, border: `2px solid ${C.gold}`, borderRadius: 7, padding: "4px 10px", fontSize: 14, color: "#ffffff", fontFamily: "monospace", fontWeight: 900, letterSpacing: "2px" }}>{id}</span>;
}
function FieldLabel({ children }) {
  return <label style={{ display: "block", fontSize: 12, color: "#b8c8d8", marginBottom: 6, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>{children}</label>;
}
function DurChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 14px", borderRadius: 20,
      border: `2px solid ${active ? C.accent : "#3a4a5c"}`,
      background: active ? "#eef4fb" : "#1a2638",
      color: active ? "#0a1220" : "#c8d4e0",
      cursor: "pointer", fontSize: 13, fontWeight: active ? 800 : 600,
      transition: "all 0.15s", boxShadow: active ? `0 0 12px ${C.accent}66` : "none",
    }}>
      {label}
    </button>
  );
}
function ErrBox({ msg }) {
  return <div style={{ background: `${C.accent2}15`, border: `1px solid ${C.accent2}55`, borderRadius: 8, padding: "10px 14px", color: C.accent2, fontSize: 13, marginTop: 10 }}>⚠ {msg}</div>;
}
const iSt = { width: "100%", padding: "10px 12px", borderRadius: 8, background: C.surfaceHigh, border: `1.5px solid ${C.border}`, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" };
function GlobalStyle() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700;900&display=swap');
    * { box-sizing: border-box; }
    input, textarea, button, a { font-family: 'Noto Sans JP', sans-serif; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
  `}</style>;
}

// ─── Calendar Picker Component ────────────────────────────────────
// value: "YYYY-MM-DDTHH:MM" 形式, onChange: 同形式で返す
function CalendarPicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parseLocal(value) : new Date();
  const [viewYear,  setViewYear]  = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth()); // 0-indexed
  const [selDate,   setSelDate]   = useState(value ? value.slice(0,10) : "");
  const [selHour,   setSelHour]   = useState(parsed.getHours());
  const [selMin,    setSelMin]    = useState(Math.floor(parsed.getMinutes()/15)*15);

  const DAYS = ["日","月","火","水","木","金","土"];
  const MONTHS = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectDay = (d) => {
    const dateStr = `${viewYear}-${pad(viewMonth+1)}-${pad(d)}`;
    setSelDate(dateStr);
    const result = `${dateStr}T${pad(selHour)}:${pad(selMin)}`;
    onChange(result);
  };

  const applyTime = (h, m) => {
    if (!selDate) return;
    const result = `${selDate}T${pad(h)}:${pad(m)}`;
    onChange(result);
  };

  const displayVal = value
    ? `${parseLocal(value).toLocaleDateString("ja-JP",{month:"short",day:"numeric",weekday:"short"})} ${pad(selHour)}:${pad(selMin)}`
    : "日付を選択";

  return (
    <div style={{ position: "relative" }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", padding: "11px 12px", borderRadius: 8, textAlign: "left",
        background: C.surfaceHigh, border: `2px solid ${open ? C.accent : "#3a4a5c"}`,
        color: value ? "#e8f4ff" : C.muted, fontSize: 15, cursor: "pointer", fontWeight: 600,
        boxShadow: open ? `0 0 12px ${C.accent}55` : "none", transition: "all 0.2s",
      }}>
        📅 {displayVal}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 100,
          background: C.surface, border: `1.5px solid ${C.accent}55`, borderRadius: 14,
          padding: 14, boxShadow: `0 8px 32px ${C.accent}22`,
        }}>
          {/* Month navigation */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y=>y-1); } else setViewMonth(m=>m-1); }}
              style={navBtnSt}>‹</button>
            <span style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>{viewYear}年 {MONTHS[viewMonth]}</span>
            <button onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y=>y+1); } else setViewMonth(m=>m+1); }}
              style={navBtnSt}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {DAYS.map((d,i) => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: i===0?C.accent2:i===6?C.accent:C.muted, padding: "2px 0" }}>{d}</div>
            ))}
          </div>

          {/* Date cells */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 12 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const dateStr = `${viewYear}-${pad(viewMonth+1)}-${pad(d)}`;
              const isSelected = selDate === dateStr;
              const isToday = dateStr === new Date().toISOString().slice(0,10);
              const dow = (firstDay + d - 1) % 7;
              return (
                <button key={i} onClick={() => selectDay(d)} style={{
                  padding: "6px 2px", borderRadius: 6, border: isSelected ? `1.5px solid ${C.gold}` : "1.5px solid transparent",
                  background: isSelected ? `${C.gold}33` : isToday ? `${C.accent}15` : "transparent",
                  color: isSelected ? C.gold : dow===0 ? C.accent2 : dow===6 ? C.accent : C.text,
                  cursor: "pointer", fontSize: 13, fontWeight: isSelected ? 800 : 400,
                  boxShadow: isSelected ? `0 0 8px ${C.gold}44` : "none",
                }}>
                  {d}
                </button>
              );
            })}
          </div>

          {/* Time picker */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>時刻</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={selHour} onChange={e => { const h = Number(e.target.value); setSelHour(h); applyTime(h, selMin); }}
                style={{ ...iSt, flex: 1, padding: "8px" }}>
                {Array.from({length:24},(_,i)=>i).map(h => <option key={h} value={h}>{pad(h)}時</option>)}
              </select>
              <span style={{ color: C.muted }}>:</span>
              <select value={selMin} onChange={e => { const m = Number(e.target.value); setSelMin(m); applyTime(selHour, m); }}
                style={{ ...iSt, flex: 1, padding: "8px" }}>
                {[0,15,30,45].map(m => <option key={m} value={m}>{pad(m)}分</option>)}
              </select>
            </div>
          </div>

          <button onClick={() => setOpen(false)} style={{
            width: "100%", marginTop: 12, padding: "10px", borderRadius: 8,
            background: C.accent, border: "none", color: C.bg,
            fontWeight: 800, cursor: "pointer", fontSize: 14,
          }}>✓ 決定</button>
        </div>
      )}
    </div>
  );
}

const navBtnSt = {
  background: "#eef4fb", border: `2px solid ${C.accent}`, borderRadius: 6,
  color: "#0a1220", cursor: "pointer", fontSize: 19, width: 34, height: 34,
  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800,
  boxShadow: `0 0 6px ${C.accent}44`,
};

// ─── Day Timeline Grid（Googleカレンダー風の日別タイムライン）─────
// freeSlots: 選択可能な空きスロット配列 {start, end, enabled}
// busyEvents: 解析された予定 [{title, start, end}]（ISO文字列）
// mode: "toggle"（参加者・複数ON/OFF) | "select"（主催者・単一選択）
function DayTimelineGrid({ freeSlots, busyEvents = [], startDate, endDate, timeFrom, timeTo, onToggleSlot, mode = "toggle", selectedSlot, onSelectSlot }) {
  // 日付ごとにグループ化
  const start = parseLocal(startDate);
  const end = parseLocal(endDate);
  const days = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= lastDay) { days.push(new Date(cur)); cur = addDays(cur, 1); }

  const [openDay, setOpenDay] = useState(0);

  // 表示する時間範囲（時間帯指定があればそれ、なければ終日0-24時）
  const [dispFromH] = timeFrom ? timeFrom.split(":").map(Number) : [0];
  const [dispToH]   = timeTo   ? timeTo.split(":").map(Number)   : [24];
  const hourRange = [];
  for (let h = dispFromH; h < (timeTo ? dispToH : 24); h++) hourRange.push(h);
  const totalMinutes = (hourRange.length || 1) * 60;

  // busyEventsとfreeSlotsを日付ごとに振り分け
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  const busyByDay = {};
  for (const e of busyEvents) {
    const s = parseLocal(e.start);
    const k = dayKey(s);
    (busyByDay[k] ||= []).push({ start: s, end: parseLocal(e.end), title: e.title });
  }

  const freeByDay = {};
  freeSlots.forEach((slot, idx) => {
    const k = dayKey(slot.start instanceof Date ? slot.start : parseLocal(slot.start));
    (freeByDay[k] ||= []).push({ ...slot, idx });
  });

  // 1分 = 何%か
  const pctOf = (date) => {
    const minsFromStart = (date.getHours() - dispFromH) * 60 + date.getMinutes();
    return Math.max(0, Math.min(100, (minsFromStart / totalMinutes) * 100));
  };

  const daysWithData = days.filter(d => (freeByDay[dayKey(d)]?.length || busyByDay[dayKey(d)]?.length));

  return (
    <div>
      {/* 時刻目盛り */}
      <div style={{ display: "flex", fontSize: 12, color: "#b8c8d8", fontWeight: 700, marginBottom: 6, paddingLeft: 78 }}>
        {hourRange.filter((_, i) => i % 3 === 0).map(h => (
          <div key={h} style={{ flex: 3, textAlign: "left" }}>{h}時</div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
        {daysWithData.length === 0 && (
          <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "20px 0" }}>該当する日程がありません</p>
        )}
        {daysWithData.map(d => {
          const k = dayKey(d);
          const dow = d.getDay();
          const free = freeByDay[k] || [];
          const busy = busyByDay[k] || [];
          const label = `${d.getMonth()+1}/${d.getDate()}(${["日","月","火","水","木","金","土"][dow]})`;
          const enabledHere = mode === "select" ? free.length : free.filter(s => s.enabled).length;
          const dowColor = dow===0 ? "#ff8a9a" : dow===6 ? "#7adfff" : "#e8f4ff";

          return (
            <div key={k} style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
              {/* 日付ラベル */}
              <div style={{ width: 70, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: dowColor }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: enabledHere ? "#5dffc0" : "#8a96a8" }}>{enabledHere>0 ? (mode==="select" ? `候補${enabledHere}` : `空${enabledHere}`) : "空きなし"}</span>
              </div>

              {/* タイムラインバー */}
              <div style={{ position: "relative", flex: 1, height: 34, background: C.bg, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}` }}>
                {/* 1時間ごとの薄い区切り線 */}
                {hourRange.map((h, i) => (
                  <div key={h} style={{ position: "absolute", left: `${(i/hourRange.length)*100}%`, top: 0, bottom: 0, width: 1, background: C.border, opacity: i%3===0?0.6:0.25 }} />
                ))}

                {/* busy（予定あり）＝灰色 */}
                {busy.map((b, i) => {
                  const left = pctOf(b.start), right = pctOf(b.end);
                  if (right <= left) return null;
                  return (
                    <div key={"b"+i} title={b.title} style={{
                      position: "absolute", left: `${left}%`, width: `${right-left}%`, top: 2, bottom: 2,
                      background: "#3a3f4a", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                    }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#c0c8d4", whiteSpace: "nowrap", padding: "0 2px" }}>{b.title}</span>
                    </div>
                  );
                })}

                {/* free（空き）＝緑（toggleモード）/ ゴールド選択（selectモード） */}
                {free.map((s) => {
                  const sd = s.start instanceof Date ? s.start : parseLocal(s.start);
                  const ed = s.end instanceof Date ? s.end : parseLocal(s.end);
                  const left = pctOf(sd), right = pctOf(ed);
                  if (right <= left) return null;

                  if (mode === "select") {
                    const isSel = selectedSlot && +parseLocal(selectedSlot.start) === +sd && +parseLocal(selectedSlot.end) === +ed;
                    return (
                      <div key={s.idx} onClick={() => onSelectSlot?.({ start: sd, end: ed })} title={`${fmtTime(sd)}〜${fmtTime(ed)}`} style={{
                        position: "absolute", left: `${left}%`, width: `${Math.max(right-left,0.6)}%`, top: 2, bottom: 2,
                        background: isSel ? C.gold : `${C.green}99`,
                        border: isSel ? `1.5px solid ${C.gold}` : `1px solid ${C.green}`,
                        borderRadius: 3, cursor: "pointer", transition: "all 0.15s",
                        boxShadow: isSel ? `0 0 8px ${C.gold}aa` : `0 0 4px ${C.green}66`,
                        zIndex: isSel ? 2 : 1,
                      }} />
                    );
                  }

                  return (
                    <div key={s.idx} onClick={() => onToggleSlot(s.idx)} title={`${fmtTime(sd)}〜${fmtTime(ed)}`} style={{
                      position: "absolute", left: `${left}%`, width: `${Math.max(right-left,0.6)}%`, top: 2, bottom: 2,
                      background: s.enabled ? `${C.green}99` : "#2a3038",
                      border: s.enabled ? `1px solid ${C.green}` : `1px solid ${C.border}`,
                      borderRadius: 3, cursor: "pointer", transition: "all 0.15s",
                      boxShadow: s.enabled ? `0 0 4px ${C.green}66` : "none",
                    }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ color: "#9aa8ba", fontSize: 12, fontWeight: 600, marginTop: 10, textAlign: "center" }}>
        バーをタップで空き時間の選択 / 解除ができます
      </p>
    </div>
  );
}
