// ============================================================
// 学中文 - HỌC TIẾNG TRUNG (HSK 1 → 9)
// ============================================================

const VAPID_PUBLIC_KEY = '';
const API_SUBSCRIBE_URL = '/api/subscribe';

const SRS_INTERVALS = [0, 1, 3, 7, 15, 30];
const LESSON_SIZE = 8;
const STORAGE_KEY = 'zhapp';

const DEFAULT_STATE = {
  streak: 0, lastStudyDate: null, xp: 0,
  dailyGoal: 10, todayCount: 0, todayDate: null,
  words: {}, lessonsCompleted: {},
  notificationEnabled: false, notificationTime: "20:00",
  lastNotificationDate: null, usePush: false,
  currentLevel: 'hsk1',
  screen: 'home', subScreen: 'levels'
};

let state = loadState();
let quizState = null;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_STATE, ...s };
  } catch { return { ...DEFAULT_STATE }; }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// ============================================================
// HELPERS
// ============================================================
function todayStr() { return new Date().toDateString(); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function toast(msg, dur = 2000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), dur);
}
function closeModal() {
  const m = document.getElementById('modal');
  if (m) m.classList.remove('active');
}
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ============================================================
// DATA ACCESS - đa cấp độ
// ============================================================
function getLevelMeta(levelId) {
  return HSK_DATA.levels.find(l => l.id === levelId);
}
function getWordsByLevel(levelId) {
  return (HSK_DATA[levelId] || []).map(w => ({ ...w, level: levelId }));
}
function getAllWords() {
  const all = [];
  HSK_DATA.levels.forEach(lv => {
    (HSK_DATA[lv.id] || []).forEach(w => all.push({ ...w, level: lv.id }));
  });
  return all;
}

function seedWords() {
  let changed = false;
  HSK_DATA.levels.forEach(lv => {
    (HSK_DATA[lv.id] || []).forEach(w => {
      if (!state.words[w.hanzi]) {
        state.words[w.hanzi] = {
          box: 0, nextReview: 0, correct: 0, wrong: 0, level: lv.id
        };
        changed = true;
      }
    });
  });
  if (changed) saveState();
}

// ============================================================
// STREAK & DAILY
// ============================================================
function resetDailyIfNewDay() {
  if (state.todayDate !== todayStr()) {
    state.todayDate = todayStr();
    state.todayCount = 0;
    saveState();
  }
}
function markStudyToday() {
  const today = todayStr();
  if (state.lastStudyDate === today) return;
  const yest = new Date(Date.now() - 86400000).toDateString();
  state.streak = (state.lastStudyDate === yest) ? state.streak + 1 : 1;
  state.lastStudyDate = today;
  saveState();
}

// ============================================================
// SRS
// ============================================================
function updateWordSRS(hanzi, correct) {
  const w = state.words[hanzi];
  if (!w) return;
  if (correct) { w.box = Math.min(w.box + 1, 5); w.correct++; }
  else { w.box = 0; w.wrong++; }
  w.nextReview = Date.now() + SRS_INTERVALS[w.box] * 86400000;
  saveState();
}

function getReviewWords(levelId) {
  const now = Date.now();
  const pool = levelId ? getWordsByLevel(levelId) : getAllWords();
  return Object.entries(state.words)
    .filter(([h, w]) => w.nextReview <= now && (w.correct + w.wrong) > 0)
    .map(([h, w]) => {
      const d = pool.find(x => x.hanzi === h);
      return d ? { ...d, ...w } : null;
    })
    .filter(Boolean);
}

// ============================================================
// LESSONS
// ============================================================
function getLessons(levelId) {
  const words = getWordsByLevel(levelId);
  const lessons = [];
  for (let i = 0; i < words.length; i += LESSON_SIZE) {
    const id = `${levelId}-${i}`;
    lessons.push({
      id, level: levelId,
      title: `Bài ${lessons.length + 1}`,
      words: words.slice(i, i + LESSON_SIZE),
      done: !!state.lessonsCompleted[id]
    });
  }
  return lessons;
}

function getLevelProgress(levelId) {
  const words = getWordsByLevel(levelId);
  const lessons = getLessons(levelId);
  const learned = words.filter(w => {
    const sw = state.words[w.hanzi];
    return sw && sw.correct > 0;
  }).length;
  const doneLessons = lessons.filter(l => l.done).length;
  return {
    totalWords: words.length,
    learnedWords: learned,
    totalLessons: lessons.length,
    doneLessons,
    pct: words.length ? Math.round((learned / words.length) * 100) : 0
  };
}

// ============================================================
// QUIZ
// ============================================================
function buildOptions(word) {
  const pool = getWordsByLevel(word.level);
  const others = pool.filter(w => w.hanzi !== word.hanzi);
  shuffle(others);
  const opts = [word.meaning, ...others.slice(0, 3).map(w => w.meaning)];
  return shuffle(opts);
}

function startQuiz(words, isReview) {
  const queue = words.map(w => ({ ...w, options: buildOptions(w) }));
  shuffle(queue);
  quizState = {
    queue, index: 0, correct: 0, total: queue.length,
    isReview, answered: false, showPinyin: false
  };
  state.screen = 'quiz';
  render();
}

function answerQuiz(btn, opt) {
  if (!quizState || quizState.answered) return;
  quizState.answered = true;
  const q = quizState.queue[quizState.index];
  const isCorrect = opt === q.meaning;

  document.querySelectorAll('.option').forEach(b => {
    b.disabled = true;
    if (b.textContent === q.meaning) b.classList.add('correct');
    else if (b === btn) b.classList.add('wrong');
  });

  if (isCorrect) {
    quizState.correct++;
    updateWordSRS(q.hanzi, true);
    state.xp += 10;
    state.todayCount++;
    markStudyToday();
    saveState();
  } else {
    updateWordSRS(q.hanzi, false);
  }

  setTimeout(() => {
    quizState.index++;
    quizState.answered = false;
    quizState.showPinyin = false;
    if (quizState.index >= quizState.total) finishQuiz();
    else render();
  }, 800);
}

function finishQuiz() {
  if (!quizState.isReview) {
    const lesson = getLessons(state.currentLevel).find(l =>
      l.words.length === quizState.queue.length &&
      l.words.every(w => quizState.queue.some(q => q.hanzi === w.hanzi))
    );
    if (lesson) state.lessonsCompleted[lesson.id] = true;
  }
  if (quizState.correct === quizState.total) state.xp += 20;
  saveState();
  const c = quizState.correct, t = quizState.total;
  quizState = null;
  state.screen = 'home';
  render();
  toast(`Hoàn thành! ${c}/${t} câu đúng 🎉`, 2500);
}

function quitQuiz() { quizState = null; state.screen = 'home'; render(); }
function showPinyin(p) {
  const el = document.getElementById('pinyin');
  if (el) el.textContent = p;
  if (quizState) quizState.showPinyin = true;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function enableNotification() {
  if (!('Notification' in window)) return toast('Trình duyệt không hỗ trợ');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Đã từ chối quyền');

  if (VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window) {
    try { await subscribePush(); state.usePush = true; }
    catch (e) { console.warn(e); state.usePush = false; toast('Dùng nhắc cục bộ'); }
  } else {
    state.usePush = false;
    toast('Đã bật nhắc cục bộ! 🔔');
  }
  state.notificationEnabled = true;
  saveState(); render();
}

async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  const res = await fetch(API_SUBSCRIBE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), time: state.notificationTime, streak: state.streak })
  });
  if (!res.ok) throw new Error('Subscribe failed');
  return sub;
}

function toggleNotification() {
  if (state.notificationEnabled) {
    state.notificationEnabled = false; state.usePush = false;
    saveState(); render(); toast('Đã tắt nhắc nhở');
  } else enableNotification();
}

async function updateNotificationTime(t) {
  state.notificationTime = t; saveState();
  toast('Đã lưu giờ nhắc');
  if (state.notificationEnabled && state.usePush) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await fetch(API_SUBSCRIBE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), time: t, streak: state.streak })
      });
    } catch {}
  }
}

function checkLocalNotification() {
  if (!state.notificationEnabled || state.usePush) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (state.lastNotificationDate === todayStr()) return;
  const [h, m] = state.notificationTime.split(':').map(Number);
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  const tgtM = h * 60 + m;
  if (nowM >= tgtM && nowM < tgtM + 60) {
    try {
      new Notification('学中文 🔥', {
        body: `Chuỗi ${state.streak} ngày đang chờ! Học 5 phút nhé.`,
        icon: './icon-192.png', tag: 'daily'
      });
    } catch {}
    state.lastNotificationDate = todayStr();
    saveState();
  }
}
setInterval(checkLocalNotification, 30000);

// ============================================================
// EXPORT / IMPORT
// ============================================================
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zhapp-${Date.now()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  toast('Đã xuất!');
}
function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d && d.words && d.xp !== undefined) {
          state = { ...DEFAULT_STATE, ...d };
          saveState(); render(); toast('Đã khôi phục!');
        } else toast('File không hợp lệ');
      } catch { toast('File không hợp lệ'); }
    };
    r.readAsText(f);
  };
  input.click();
}
function resetAll() {
  if (!confirm('Xóa toàn bộ tiến độ?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = { ...DEFAULT_STATE };
  seedWords(); render(); toast('Đã xóa');
}

// ============================================================
// HANZI WRITER
// ============================================================
function showHanziWriter(char) {
  const m = document.getElementById('modal');
  const c = document.getElementById('modal-content');
  if (!m || !c) return;
  m.classList.add('active');
  c.innerHTML = `
    <h3 style="text-align:center;color:var(--primary);font-size:48px;letter-spacing:4px;margin-bottom:8px">${char}</h3>
    <div id="hanzi-target" style="display:flex;justify-content:center;background:var(--bg);border-radius:12px;padding:10px"></div>
    <button class="btn secondary" onclick="closeModal()" style="margin-top:16px">Đóng</button>
  `;
  try {
    new HanziWriter('hanzi-target', char, {
      width: 240, height: 240, padding: 8, showOutline: true,
      strokeAnimationSpeed: 1, delayBetweenStrokes: 400,
      strokeColor: '#e74c3c', radicalColor: '#f39c12'
    }).animateCharacter();
  } catch {}
}

// ============================================================
// SCREENS
// ============================================================
function renderHome() {
  const goalPct = Math.min(100, (state.todayCount / state.dailyGoal) * 100);
  const reviewAll = getReviewWords().length;
  const learnedAll = Object.values(state.words).filter(w => w.correct > 0).length;
  const curLv = getLevelMeta(state.currentLevel);
  const curProg = getLevelProgress(state.currentLevel);

  return `
    <div class="header"><h1>学中文</h1><div class="sub">Học tiếng Trung mỗi ngày</div></div>
    <div class="card">
      <div class="stat-row">
        <div class="stat"><div class="num">🔥 ${state.streak}</div><div class="label">Chuỗi ngày</div></div>
        <div class="stat"><div class="num">${state.xp}</div><div class="label">XP</div></div>
        <div class="stat"><div class="num">${learnedAll}</div><div class="label">Đã học</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Mục tiêu hôm nay</div>
      <div class="progress"><div class="progress-bar" style="width:${goalPct}%"></div></div>
      <div class="progress-label"><span>${state.todayCount}/${state.dailyGoal} câu</span><span>${Math.round(goalPct)}%</span></div>
    </div>
    <div class="card" style="border-left:4px solid ${curLv.color}">
      <div class="card-title">📖 Cấp độ đang học: <span style="color:${curLv.color}">${curLv.name}</span></div>
      <div class="progress"><div class="progress-bar" style="width:${curProg.pct}%;background:${curLv.color}"></div></div>
      <div class="progress-label"><span>${curProg.learnedWords}/${curProg.totalWords} từ</span><span>${curProg.pct}%</span></div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn small" style="flex:1;background:${curLv.color}" onclick="go('levels')">Đổi cấp độ</button>
      </div>
    </div>
    <button class="btn" onclick="go('learn')">📚 Học ${curLv.name}</button>
    <div style="height:10px"></div>
    <button class="btn gold" onclick="go('review')">🔄 Ôn tập (${reviewAll})</button>
  `;
}

function renderLevels() {
  return `
    <div class="header"><h1>Chọn cấp độ HSK</h1><div class="sub">Lộ trình từ nhập môn đến chuyên gia</div></div>
    ${HSK_DATA.levels.map(lv => {
      const p = getLevelProgress(lv.id);
      const active = state.currentLevel === lv.id;
      return `
        <div class="lesson-item ${active ? 'done' : ''}"
             onclick="selectLevel('${lv.id}')"
             style="${active ? `border-color:${lv.color};background:${lv.color}10` : ''}">
          <div class="lesson-num" style="background:${lv.color}">${lv.name.replace('HSK ','')}</div>
          <div class="lesson-info">
            <div class="title">${lv.name} <span style="color:${lv.color};font-size:11px">• ${lv.desc}</span></div>
            <div class="desc">${p.learnedWords}/${p.totalWords} từ • ${p.doneLessons}/${p.totalLessons} bài • ${p.pct}%</div>
          </div>
        </div>
      `;
    }).join('')}
    <div style="text-align:center;font-size:11px;color:var(--muted);padding:16px">
      💡 Danh sách đầy đủ có thể tải về và thêm vào data.js
    </div>
  `;
}

function renderLearn() {
  const lessons = getLessons(state.currentLevel);
  const lv = getLevelMeta(state.currentLevel);
  const done = lessons.filter(l => l.done).length;
  return `
    <div class="header">
      <h1>${lv.name}</h1>
      <div class="sub">${done}/${lessons.length} bài • ${lv.desc}</div>
    </div>
    <button class="btn secondary" onclick="go('levels')" style="margin-bottom:12px">🔀 Đổi cấp độ</button>
    ${lessons.map(l => `
      <div class="lesson-item ${l.done ? 'done' : ''}" onclick='startLesson("${l.id}")'>
        <div class="lesson-num" style="background:${l.done ? '' : lv.color}">${l.done ? '✓' : l.title.replace('Bài ','')}</div>
        <div class="lesson-info">
          <div class="title">${l.title}</div>
          <div class="desc">${l.words.length} từ • ${l.words.slice(0, 3).map(w => w.hanzi).join(' ')}...</div>
        </div>
      </div>
    `).join('')}
  `;
}

function renderReview() {
  const words = getReviewWords();
  if (words.length === 0) return `
    <div class="header"><h1>Ôn tập</h1></div>
    <div class="empty"><div class="emoji">✨</div><p>Đã ôn xong hôm nay!</p></div>`;
  const byLevel = {};
  words.forEach(w => { byLevel[w.level] = (byLevel[w.level] || 0) + 1; });
  return `
    <div class="header"><h1>Ôn tập SRS</h1><div class="sub">${words.length} từ đến hạn (tất cả cấp độ)</div></div>
    <div class="card">
      <div class="card-title">🧠 Ôn tập thông minh</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">
        ${Object.entries(byLevel).map(([lv, c]) => {
          const m = getLevelMeta(lv);
          return `<span style="background:${m.color}20;color:${m.color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${m.name}: ${c}</span>`;
        }).join('')}
      </div>
      <button class="btn" onclick="startReviewQuiz()">Bắt đầu ôn tập</button>
    </div>
  `;
}

function renderStats() {
  const learned = Object.values(state.words).filter(w => w.correct > 0).length;
  const mastered = Object.values(state.words).filter(w => w.box >= 4).length;

  return `
    <div class="header"><h1>Thống kê</h1></div>
    <div class="card">
      <div class="stat-row">
        <div class="stat"><div class="num">🔥 ${state.streak}</div><div class="label">Chuỗi ngày</div></div>
        <div class="stat"><div class="num">${state.xp}</div><div class="label">XP</div></div>
        <div class="stat"><div class="num">${mastered}</div><div class="label">Đã thuộc</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">📊 Tiến độ theo cấp độ</div>
      ${HSK_DATA.levels.map(lv => {
        const p = getLevelProgress(lv.id);
        return `
          <div style="margin-top:12px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
              <span style="color:${lv.color};font-weight:600">${lv.name}</span>
              <span style="color:var(--muted)">${p.learnedWords}/${p.totalWords} từ</span>
            </div>
            <div class="progress" style="margin:0">
              <div class="progress-bar" style="width:${p.pct}%;background:${lv.color}"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="card">
      <div class="card-title">🏆 Huy hiệu</div>
      ${(() => {
        const b = [];
        if (state.streak >= 3) b.push('🔥 3 ngày');
        if (state.streak >= 7) b.push('⭐ 7 ngày');
        if (state.streak >= 30) b.push('👑 30 ngày');
        if (mastered >= 10) b.push('📖 10 từ');
        if (mastered >= 50) b.push('📚 50 từ');
        if (mastered >= 100) b.push('🎓 100 từ');
        if (state.xp >= 500) b.push('💎 500XP');
        if (state.xp >= 2000) b.push('💠 2000XP');
        return b.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${b.map(x => `<span style="background:var(--bg);padding:8px 12px;border-radius:20px;font-size:12px;font-weight:600">${x}</span>`).join('')}</div>`
          : `<p style="font-size:13px;color:var(--muted)">Chưa có. Học đều để mở khóa! 🎯</p>`;
      })()}
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="header"><h1>Cài đặt</h1></div>
    <div class="card">
      <div class="card-title">🔔 Nhắc nhở học tập</div>
      <div class="setting-row">
        <label>Bật nhắc nhở</label>
        <div class="toggle ${state.notificationEnabled ? 'on' : ''}" onclick="toggleNotification()"></div>
      </div>
      ${state.notificationEnabled ? `
        <div class="setting-row">
          <label>Giờ nhắc</label>
          <input type="time" value="${state.notificationTime}" onchange="updateNotificationTime(this.value)">
        </div>
        <div class="setting-row">
          <label>Chế độ</label>
          <span style="font-size:12px;color:${state.usePush ? 'var(--success)' : 'var(--muted)'}">
            ${state.usePush ? '✓ Push server' : 'Cục bộ'}
          </span>
        </div>
      ` : ''}
    </div>
    <div class="card">
      <div class="card-title">🎯 Mục tiêu hàng ngày</div>
      <div class="setting-row">
        <label>Số câu mỗi ngày</label>
        <input type="number" min="5" max="100" step="5" value="${state.dailyGoal}"
               style="width:80px;padding:8px;border-radius:8px;border:2px solid var(--border);text-align:center"
               onchange="state.dailyGoal=Math.max(5,parseInt(this.value)||10);saveState();render()">
      </div>
    </div>
    <div class="card">
      <div class="card-title">💾 Dữ liệu</div>
      <button class="btn secondary" onclick="exportData()" style="margin-bottom:10px">📤 Xuất tiến độ</button>
      <button class="btn secondary" onclick="importData()">📥 Nhập tiến độ</button>
    </div>
    <div class="card">
      <div class="card-title">⚠️ Vùng nguy hiểm</div>
      <button class="btn secondary" onclick="resetAll()" style="color:var(--danger);border-color:var(--danger)">Xóa toàn bộ tiến độ</button>
    </div>
    <div style="text-align:center;padding:20px;font-size:12px;color:var(--muted)">
      学中文 v2.0 • HSK 1 → 9 • Made with ❤️
    </div>
  `;
}

function renderQuiz() {
  if (!quizState) { state.screen = 'home'; return renderHome(); }
  const q = quizState.queue[quizState.index];
  if (!q) return '';
  const pct = (quizState.index / quizState.total) * 100;
  return `
    <div class="quiz-header">
      <div class="quiz-progress"><div class="quiz-progress-bar" style="width:${pct}%"></div></div>
      <div class="quiz-count">${quizState.index + 1}/${quizState.total}</div>
    </div>
    <div class="question">
      <div class="hanzi">${q.hanzi}</div>
      <div class="pinyin" id="pinyin">${quizState.showPinyin ? q.pinyin : '&nbsp;'}</div>
      <div class="question-hint">
        <button class="hint-btn" onclick="showPinyin('${q.pinyin}')">👁 Pinyin</button>
        <button class="hint-btn" onclick="showHanziWriter('${q.hanzi}')">✍️ Viết</button>
      </div>
    </div>
    <div class="options">
      ${q.options.map(o => {
        const safe = o.replace(/'/g, "\\'");
        return `<button class="option" onclick="answerQuiz(this, '${safe}')">${o}</button>`;
      }).join('')}
    </div>
    <div style="height:16px"></div>
    <button class="btn secondary" onclick="quitQuiz()">Thoát</button>
  `;
}

// ============================================================
// ACTIONS
// ============================================================
function go(screen) { state.screen = screen; render(); }
function selectLevel(id) {
  state.currentLevel = id;
  saveState();
  go('learn');
  toast(`Đã chọn ${getLevelMeta(id).name}`);
}
function startLesson(lessonId) {
  const l = getLessons(state.currentLevel).find(x => x.id === lessonId);
  if (!l) return;
  startQuiz(l.words.map(w => ({ ...w, lessonId })), false);
}
function startReviewQuiz() {
  const words = getReviewWords();
  if (!words.length) return toast('Không có từ cần ôn');
  startQuiz(words, true);
}

// ============================================================
// RENDER
// ============================================================
function renderNav() {
  if (state.screen === 'quiz') return '';
  const items = [
    { id: 'home', icon: '🏠', label: 'Trang chủ' },
    { id: 'learn', icon: '📚', label: 'Học' },
    { id: 'review', icon: '🔄', label: 'Ôn tập' },
    { id: 'stats', icon: '📊', label: 'Thống kê' },
    { id: 'settings', icon: '⚙️', label: 'Cài đặt' }
  ];
  return `<div class="nav">${items.map(i => `
    <div class="nav-item ${state.screen === i.id ? 'active' : ''}" onclick="go('${i.id}')">
      <span class="icon">${i.icon}</span>${i.label}
    </div>
  `).join('')}</div>`;
}

function render() {
  resetDailyIfNewDay();
  const app = document.getElementById('app');
  if (!app) return;
  let content = '';
  switch (state.screen) {
    case 'home':     content = renderHome(); break;
    case 'levels':   content = renderLevels(); break;
    case 'learn':    content = renderLearn(); break;
    case 'review':   content = renderReview(); break;
    case 'stats':    content = renderStats(); break;
    case 'settings': content = renderSettings(); break;
    case 'quiz':     content = renderQuiz(); break;
    default:         content = renderHome();
  }
  app.innerHTML = content + renderNav();
  window.scrollTo(0, 0);
}

// ============================================================
// INIT
// ============================================================
function init() {
  seedWords();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
  }
  render();
  setTimeout(checkLocalNotification, 5000);
}
init();