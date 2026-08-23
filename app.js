// ===== Supabase 및 권한 설정 =====
// 필요 시 Supabase 대시보드에서 발급받은 URL과 Anon Key로 교체해 주세요.
const SUPABASE_URL = 'https://gzbnybhmxetxrsjwbgdq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_u94UX3GzncebQK2X8ZKckg_k0Q8edot';

let supabaseClient = null;
if (window.supabase && SUPABASE_URL && !SUPABASE_URL.includes('YOUR_SUPABASE')) {
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.error('Supabase 클라이언트 초기화 실패:', err);
  }
}

// 등록 권한 비밀번호 (하드코딩)
const ADMIN_PASSWORD = '7777';
let isAdmin = localStorage.getItem('school_planner_is_admin') === 'true';

// 기본 시간표 및 교사 정보 (Supabase 데이터 미존재 시 초기 시드용)
const defaultSchedule = {
  1: ['공통영어', '통합사회', '체육', '진로직업', '통합사회'],
  2: ['공통국어', '공통수학', '음악', '통합사회', '한국사'],
  3: ['한국사', '공통영어', '통합과학', '공통국어', '공통수학'],
  4: ['통합사회', '공통국어', '진로직업', '공통수학', '공통영어'],
  5: ['기술', '통합과학', '한국사', '가정', '통합과학'],
  6: ['공통수학', '기술', '진로', '체육', '창체'],
  7: ['창체', '음악', '', '공통영어', '창체']
};
const defaultTeachers = {
  1: ['이지은', '임태형', '심선덕', '김영', '김영'],
  2: ['안혜리', '임지은', '이경수', '최진현', '박문주'],
  3: ['박문주', '김세인', '정이슬', '김민소', '임지은'],
  4: ['이선미', '신명은', '김영', '임지은', '정찬원'],
  5: ['강경완', '최경화', '박문주', '안진선', '김지훈'],
  6: ['임지은', '강경완', '신명은', '심선덕', ''],
  7: ['', '이경수', '', '이지은', '']
};
const subjectColors = { '공통영어': '#f3df8b', '통합사회': '#edb993', '체육': '#b795d0', '진로직업': '#efb28a', '공통국어': '#b7c4e5', '공통수학': '#a7dccb', '음악': '#b8f000', '한국사': '#bebebe', '통합과학': '#d7c4e5', '기술': '#93acd9', '가정': '#93acd9', '진로': '#e2e2e2', '창체': '#eee' };

// 2026년 한국 공휴일.
const holidays = {
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴', '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-01': '근로자의 날', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-06': '현충일', '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일', '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절'
};

const STORAGE_KEY = 'school-planner-assessments-v1';

// 클라이언트 상태
let items = [];
let defaultLocations = {};
let dateLocations = {};
let dbSchedule = { ...defaultSchedule };
let dbTeachers = { ...defaultTeachers };
let selectedDate = new Date(), editImage = '', editingId = null;

const $ = id => document.getElementById(id);
const fmtDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateText = iso => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${iso}T12:00:00`));
const escape = text => String(text).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
function daySubject(iso, period) { const week = new Date(`${iso}T12:00:00`).getDay(); return week && week < 6 && period ? dbSchedule[period]?.[week - 1] || '' : ''; }
function toast(message) { const box = $('toast'); box.textContent = message; box.classList.add('show'); setTimeout(() => box.classList.remove('show'), 2800); }

function getLocation(isoDate, period, subject) {
  if (isoDate && period && dateLocations[isoDate] && dateLocations[isoDate][period] !== undefined) {
    return dateLocations[isoDate][period];
  }
  if (subject && defaultLocations[subject]) {
    return defaultLocations[subject];
  }
  return '';
}

function isDateOverride(isoDate, period) {
  return Boolean(isoDate && period && dateLocations[isoDate] && dateLocations[isoDate][period] !== undefined);
}

// ===== Supabase Data Fetching & Sync =====
async function loadItemsData() {
  if (!supabaseClient) {
    try { items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { items = []; }
    return;
  }
  try {
    const { data, error } = await supabaseClient.from('assessments').select('*').order('date', { ascending: true });
    if (error) throw error;
    items = (data || []).map(item => ({
      ...item,
      updatedAt: item.updated_at || item.updatedAt || new Date().toISOString()
    }));
  } catch (err) {
    console.error('assessments 로드 실패:', err);
  }
}

async function loadTimetableData() {
  if (!supabaseClient) {
    dbSchedule = { ...defaultSchedule };
    dbTeachers = { ...defaultTeachers };
    return;
  }
  try {
    const { data, error } = await supabaseClient.from('timetable').select('*');
    if (error) throw error;
    if (!data || data.length === 0) {
      dbSchedule = { ...defaultSchedule };
      dbTeachers = { ...defaultTeachers };
      seedDefaultTimetable();
    } else {
      const scheduleMap = { 1: ['', '', '', '', ''], 2: ['', '', '', '', ''], 3: ['', '', '', '', ''], 4: ['', '', '', '', ''], 5: ['', '', '', '', ''], 6: ['', '', '', '', ''], 7: ['', '', '', '', ''] };
      const teacherMap = { 1: ['', '', '', '', ''], 2: ['', '', '', '', ''], 3: ['', '', '', '', ''], 4: ['', '', '', '', ''], 5: ['', '', '', '', ''], 6: ['', '', '', '', ''], 7: ['', '', '', '', ''] };
      data.forEach(row => {
        if (row.period >= 1 && row.period <= 7 && row.day_of_week >= 1 && row.day_of_week <= 5) {
          scheduleMap[row.period][row.day_of_week - 1] = row.subject || '';
          teacherMap[row.period][row.day_of_week - 1] = row.teacher || '';
        }
      });
      dbSchedule = scheduleMap;
      dbTeachers = teacherMap;
    }
  } catch (err) {
    console.error('timetable 로드 실패:', err);
    dbSchedule = { ...defaultSchedule };
    dbTeachers = { ...defaultTeachers };
  }
}

async function seedDefaultTimetable() {
  if (!supabaseClient || !isAdmin) return;
  const rows = [];
  Object.entries(defaultSchedule).forEach(([period, subjects]) => {
    subjects.forEach((subj, idx) => {
      const p = Number(period);
      const dow = idx + 1;
      const tch = defaultTeachers[p]?.[idx] || '';
      rows.push({
        id: `p${p}_d${dow}`,
        period: p,
        day_of_week: dow,
        subject: subj,
        teacher: tch,
        updated_at: new Date().toISOString()
      });
    });
  });
  try {
    await supabaseClient.from('timetable').upsert(rows);
  } catch (e) {
    console.error('기본 시간표 시드 실패:', e);
  }
}

async function loadDefaultLocationsData() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('subject_locations').select('*');
    if (error) throw error;
    const locMap = {};
    (data || []).forEach(row => {
      if (row.subject && row.default_location) {
        locMap[row.subject] = row.default_location;
      }
    });
    defaultLocations = locMap;
  } catch (err) {
    console.error('subject_locations 로드 실패:', err);
  }
}

async function loadDateLocationsData() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('timetable_location_overrides').select('*');
    if (error) throw error;
    const overrideMap = {};
    (data || []).forEach(row => {
      if (row.date && row.period) {
        if (!overrideMap[row.date]) overrideMap[row.date] = {};
        if (row.location !== null && row.location !== undefined && row.location !== '') {
          overrideMap[row.date][row.period] = row.location;
        }
      }
    });
    dateLocations = overrideMap;
  } catch (err) {
    console.error('timetable_location_overrides 로드 실패:', err);
  }
}

async function loadAllData() {
  await Promise.all([
    loadItemsData(),
    loadTimetableData(),
    loadDefaultLocationsData(),
    loadDateLocationsData()
  ]);
  render();
}

async function loadAllDataSilently() {
  await Promise.all([
    loadItemsData(),
    loadTimetableData(),
    loadDefaultLocationsData(),
    loadDateLocationsData()
  ]);
  render();
}

async function setDefaultLocation(subject, location) {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다.');
    return;
  }
  const trimmed = (location || '').trim();
  if (trimmed) {
    defaultLocations[subject] = trimmed;
  } else {
    delete defaultLocations[subject];
  }

  if (supabaseClient) {
    try {
      if (trimmed) {
        const { error } = await supabaseClient.from('subject_locations').upsert([{
          subject: subject,
          default_location: trimmed,
          updated_at: new Date().toISOString()
        }]);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from('subject_locations').delete().eq('subject', subject);
        if (error) throw error;
      }
    } catch (e) {
      console.error('Supabase 기본 장소 저장 오류:', e);
      toast('기본 장소 저장에 실패했습니다.');
      return;
    }
  }
  render();
  toast(`'${subject}' 기본 장소가 저장되었습니다.`);
}

async function setDateLocation(isoDate, period, location) {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다.');
    return;
  }
  const isDelete = (location === null || location === undefined || location.trim() === '');
  const id = `${isoDate}_${period}`;

  if (isDelete) {
    if (dateLocations[isoDate]) {
      delete dateLocations[isoDate][period];
      if (Object.keys(dateLocations[isoDate]).length === 0) {
        delete dateLocations[isoDate];
      }
    }
  } else {
    if (!dateLocations[isoDate]) dateLocations[isoDate] = {};
    dateLocations[isoDate][period] = location.trim();
  }

  if (supabaseClient) {
    try {
      if (isDelete) {
        const { error } = await supabaseClient.from('timetable_location_overrides').delete().eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from('timetable_location_overrides').upsert([{
          id: id,
          date: isoDate,
          period: Number(period),
          location: location.trim(),
          updated_at: new Date().toISOString()
        }]);
        if (error) throw error;
      }
    } catch (e) {
      console.error('Supabase 특정 날짜 장소 저장 오류:', e);
      toast('수업 장소 저장에 실패했습니다.');
      return;
    }
  }
  render();
  toast('수업 장소가 저장되었습니다.');
}

// ===== Supabase Realtime & Fallback =====
let realtimeChannel = null;
let fallbackTimer = null;

function setupRealtime() {
  if (!supabaseClient) return;

  if (realtimeChannel) {
    try { supabaseClient.removeChannel(realtimeChannel); } catch (e) {}
  }

  try {
    realtimeChannel = supabaseClient
      .channel('school-planner-realtime-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assessments' }, () => loadAllDataSilently())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timetable' }, () => loadAllDataSilently())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subject_locations' }, () => loadAllDataSilently())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timetable_location_overrides' }, () => loadAllDataSilently())
      .subscribe((status) => {
        console.log('Supabase Realtime 구독 상태:', status);
      });
  } catch (err) {
    console.error('Supabase Realtime 초기화 오류:', err);
  }
}

function startFallbackTimer() {
  stopFallbackTimer();
  fallbackTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadAllDataSilently();
    }
  }, 60000);
}

function stopFallbackTimer() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadAllDataSilently();
    startFallbackTimer();
  } else {
    stopFallbackTimer();
  }
});

window.addEventListener('beforeunload', () => {
  stopFallbackTimer();
  if (supabaseClient && realtimeChannel) {
    try { supabaseClient.removeChannel(realtimeChannel); } catch (e) {}
  }
});

function updateAuthUI() {
  const authBtn = $('authBtn');
  const newBtn = $('newEntryBtn');
  if (authBtn) {
    if (isAdmin) {
      authBtn.textContent = '🔒 등록 권한 해제';
      authBtn.title = '클릭하면 일반 사용자(조회 전용) 모드로 전환됩니다';
    } else {
      authBtn.textContent = '🔑 등록 권한';
      authBtn.title = '수행평가·과제 등록/수정 비밀번호 입력';
    }
  }
  if (newBtn) {
    newBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }
}

function handleAuthToggle() {
  if (isAdmin) {
    isAdmin = false;
    localStorage.removeItem('school_planner_is_admin');
    updateAuthUI();
    render();
    toast('일반 사용자(조회 전용) 모드로 전환되었습니다.');
  } else {
    const input = prompt('등록 권한 비밀번호를 입력해 주세요:');
    if (input === null) return;
    if (input === ADMIN_PASSWORD) {
      isAdmin = true;
      localStorage.setItem('school_planner_is_admin', 'true');
      updateAuthUI();
      render();
      toast('등록 권한이 활성화되었습니다!');
    } else {
      toast('비밀번호가 올바르지 않습니다.');
    }
  }
}

function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch { throw new Error('저장 공간이 부족해요. 사진 크기를 줄이거나 이전 일정을 삭제해 주세요.'); }
}

async function saveItem(item) {
  if (!isAdmin) {
    toast('수행평가·과제를 저장할 권한이 없습니다.');
    return;
  }
  const record = {
    id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: item.title.trim(),
    type: item.type || '과제',
    date: item.date,
    period: item.period || '',
    subject: item.subject.trim() || '기타',
    description: item.description.trim(),
    image: item.image || '',
    completed: Boolean(item.completed),
    updated_at: new Date().toISOString()
  };

  if (supabaseClient) {
    const { error } = await supabaseClient.from('assessments').upsert([record]);
    if (error) {
      console.error('Supabase 저장 오류:', error);
      throw new Error(error.message || 'Supabase 저장에 실패했습니다.');
    }
  } else {
    const index = items.findIndex(v => v.id === record.id);
    if (index < 0) items.push(record); else items[index] = record;
    saveLocal();
  }
  await loadAllData();
}

async function deleteItem(id) {
  if (!isAdmin) {
    toast('수행평가·과제를 삭제할 권한이 없습니다.');
    return;
  }
  if (supabaseClient) {
    const { error } = await supabaseClient.from('assessments').delete().eq('id', id);
    if (error) {
      console.error('Supabase 삭제 오류:', error);
      throw new Error(error.message || 'Supabase 삭제에 실패했습니다.');
    }
  } else {
    items = items.filter(item => item.id !== id);
    saveLocal();
  }
  await loadAllData();
}

function render() { renderCalendar(); renderUpcoming(); renderTodayStatus(); renderDailyView(); renderTimetable(); }
function renderTodayStatus() { $('todayStatus').textContent = items.filter(item => item.date === fmtDate(new Date())).length ? '오늘 일정이 있어요.' : '오늘 일정은 아직 없어요'; }
function renderCalendar() {
  const y = selectedDate.getFullYear(), m = selectedDate.getMonth(); $('monthTitle').textContent = `${y}년 ${m + 1}월`;
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay()); const lastDay = new Date(y, m + 1, 0).getDate(); const needed = Math.ceil((first.getDay() + lastDay) / 7) * 7; const today = fmtDate(new Date());
  $('calendar').innerHTML = Array.from({ length: needed }, (_, index) => {
    const date = new Date(start); date.setDate(start.getDate() + index); const iso = fmtDate(date), inMonth = date.getMonth() === m, weekday = date.getDay(), dayItems = items.filter(item => item.date === iso).sort((a, b) => Number(a.period || 99) - Number(b.period || 99)); const holiday = holidays[iso];
    const events = dayItems.slice(0, 3).map(item => `<button class="calendar-entry" data-id="${item.id}" style="border-color:${subjectColors[item.subject] || '#a7b4c5'}">${item.period ? item.period + '교시 ' : ''}${escape(item.title)}</button>`).join('');
    return `<div class="day ${inMonth ? '' : 'other'} ${weekday === 0 ? 'sun' : ''} ${weekday === 6 ? 'sat' : ''} ${holiday ? 'holiday' : ''} ${iso === today ? 'today' : ''}" data-date="${iso}"><span class="date-number">${date.getDate()}</span>${holiday ? `<div class="holiday-name">${holiday}</div>` : ''}${events}${dayItems.length > 3 ? `<div class="more">+ ${dayItems.length - 3}개 더</div>` : ''}</div>`;
  }).join('');
}
function renderUpcoming() { const monthPrefix = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`; const monthItems = items.filter(item => item.date.startsWith(monthPrefix)).sort((a, b) => a.date.localeCompare(b.date) || Number(a.period || 99) - Number(b.period || 99)); $('openCount').textContent = `${monthItems.length}개 일정`; $('upcomingList').innerHTML = monthItems.length ? monthItems.slice(0, 8).map(item => `<article class="task-card" data-id="${item.id}"><div><h3>${escape(item.title)}</h3><div class="task-meta">${dateText(item.date)}${item.period ? ' · ' + item.period + '교시' : ''} <span class="subject-pill">· ${escape(item.subject)}</span></div></div></article>`).join('') : '<p class="nothing">이번 달 일정이 없어요.</p>'; }
function renderDailyView() {
  const iso = $('scheduleDate').value || fmtDate(new Date()), date = new Date(`${iso}T12:00:00`), weekday = date.getDay(), today = fmtDate(new Date());
  $('dailyTitle').textContent = iso === today ? '오늘의 수업' : `${date.getMonth() + 1}월 ${date.getDate()}일 수업`;
  const holiday = holidays[iso];
  if (holiday) {
    $('dailySchedule').innerHTML = `<div class="daily-holiday">${holiday} · 수업이 없어요</div>`;
  } else if (weekday === 0 || weekday === 6) {
    $('dailySchedule').innerHTML = '<p class="daily-empty">주말에는 정규 수업이 없어요.</p>';
  } else {
    $('dailySchedule').innerHTML = Object.entries(dbSchedule).map(([period, subjects]) => {
      const subject = subjects[weekday - 1], teacher = dbTeachers[period]?.[weekday - 1];
      if (!subject) return '';
      const loc = getLocation(iso, period, subject);
      const isOverride = isDateOverride(iso, period);
      return `<div class="daily-row">
        <span class="daily-period">${period}교시</span>
        <div class="daily-subject-cell">
          <span class="daily-subject" style="border-color:${subjectColors[subject] || '#bdc3ce'}">
            <span class="daily-subject-title">${escape(subject)}</span>
            <small>${teacher ? escape(teacher) + ' 선생님' : '담당 선생님'}${loc ? ` <span class="daily-loc-badge ${isOverride ? 'override' : ''}">📍 ${escape(loc)}</span>` : ''}</small>
          </span>
          ${isAdmin ? `<button type="button" class="tiny-loc-btn" data-date="${iso}" data-period="${period}" data-subject="${escape(subject)}" title="해당 날짜 장소 변경">📍 장소 변경</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  const dayItems = items.filter(item => item.date === iso).sort((a, b) => Number(a.period || 99) - Number(b.period || 99));
  $('dailyTasks').innerHTML = dayItems.length ? `<h3>그날의 수행평가 · 과제</h3>${dayItems.map(item => `<div class="daily-task" data-id="${item.id}">${item.period ? item.period + '교시 · ' : ''}${escape(item.title)}</div>`).join('')}` : '';
}

function renderTimetable() {
  $('timetableList').innerHTML = `<div class="schedule-header">${['월', '화', '수', '목', '금'].map(day => `<span>${day}</span>`).join('')}</div>` + Object.entries(dbSchedule).map(([period, subjects]) => `<div class="schedule-row"><span class="schedule-period">${period}</span><div class="schedule-subjects">${subjects.map((subject, index) => {
    const loc = getLocation('', period, subject);
    return `<span title="${subject}" style="background:${subjectColors[subject] || 'transparent'}">${subject || '—'}${subject && dbTeachers[period]?.[index] ? `<small>${dbTeachers[period][index]} 선생님</small>` : ''}${loc ? `<small class="schedule-loc-tag">📍 ${escape(loc)}</small>` : ''}</span>`;
  }).join('')}</div></div>`).join('');
  $('subjects').innerHTML = Object.keys(subjectColors).map(subject => `<option value="${subject}">`).join('');
  renderDefaultLocations();
}

function renderDefaultLocations() {
  const container = $('defaultLocationsList');
  if (!container) return;
  const subjects = Object.keys(subjectColors);
  container.innerHTML = subjects.map(subject => {
    const loc = defaultLocations[subject] || '';
    return `
      <div class="default-loc-item">
        <span class="default-loc-name" style="border-left:4px solid ${subjectColors[subject] || '#ccc'}">${escape(subject)}</span>
        <input class="default-loc-input" data-subject="${escape(subject)}" value="${escape(loc)}" placeholder="기본 장소 (예: 1-3)" ${isAdmin ? '' : 'disabled'} />
      </div>
    `;
  }).join('');

  container.querySelectorAll('.default-loc-input').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!isAdmin) return;
      const subj = e.target.dataset.subject;
      setDefaultLocation(subj, e.target.value);
    });
  });
}

function setDateAndSubject(iso, period = '') { $('date').value = iso; $('period').value = period; $('subject').value = daySubject(iso, period); }

function setFormDisabled(disabled) {
  $('title').disabled = disabled;
  $('type').disabled = disabled;
  $('date').disabled = disabled;
  $('period').disabled = disabled;
  $('subject').disabled = disabled;
  $('description').disabled = disabled;
  $('image').disabled = disabled;
  $('saveBtn').style.display = disabled ? 'none' : 'inline-block';
}

function openNew(iso = fmtDate(new Date()), period = '') {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다. 상단의 [🔑 등록 권한] 버튼을 클릭해 주세요.');
    return;
  }
  editingId = null; editImage = ''; $('entryForm').reset(); $('entryId').value = ''; $('formEyebrow').textContent = '새 일정'; $('formTitle').textContent = '수행평가·과제 추가'; $('deleteBtn').hidden = true; $('imagePreview').innerHTML = ''; setFormDisabled(false); setDateAndSubject(iso, period); $('entryDialog').showModal(); $('title').focus();
}

function openEdit(id) {
  const item = items.find(value => value.id === id); if (!item) return;
  editingId = id; editImage = item.image || ''; $('entryId').value = id; $('title').value = item.title; $('type').value = item.type; $('date').value = item.date; $('period').value = item.period; $('subject').value = item.subject; $('description').value = item.description; $('image').value = ''; previewImage(editImage);
  if (isAdmin) {
    $('formEyebrow').textContent = '일정 수정'; $('formTitle').textContent = item.title; $('deleteBtn').hidden = false; setFormDisabled(false);
  } else {
    $('formEyebrow').textContent = '일정 상세 (조회 전용)'; $('formTitle').textContent = item.title; $('deleteBtn').hidden = true; setFormDisabled(true);
  }
  $('entryDialog').showModal();
}

let currentLocTarget = null;
function openLocationDialog(date, period, subject) {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다. 상단의 [🔑 등록 권한] 버튼을 클릭해 주세요.');
    return;
  }
  currentLocTarget = { date, period, subject };
  const dText = dateText(date);
  const defaultLoc = defaultLocations[subject] || '설정 안 됨';
  const currentOverride = dateLocations[date]?.[period];
  const activeLoc = getLocation(date, period, subject);

  $('locDialogTitle').textContent = `${dText} ${period}교시 (${subject})`;
  $('locDialogInput').value = currentOverride !== undefined ? currentOverride : activeLoc;
  $('locDefaultVal').textContent = defaultLoc;
  $('resetLocBtn').hidden = (currentOverride === undefined);

  $('locationDialog').showModal();
}

function previewImage(src) { $('imagePreview').innerHTML = src ? `<img alt="첨부 사진 미리보기" src="${src}">` : ''; }
function getFileAsData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

if ($('authBtn')) $('authBtn').onclick = handleAuthToggle;
$('newEntryBtn').onclick = () => openNew();
$('prevMonth').onclick = () => { selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1); render(); };
$('nextMonth').onclick = () => { selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1); render(); };
document.querySelectorAll('.view-tab').forEach(button => button.addEventListener('click', () => { const view = button.dataset.view; $('plannerGrid').className = `planner-grid view-${view}`; document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab === button)); if (view === 'today') { $('scheduleDate').value = fmtDate(new Date()); renderDailyView(); } }));
$('scheduleToday').onclick = () => { $('scheduleDate').value = fmtDate(new Date()); renderDailyView(); };
$('scheduleDate').addEventListener('change', renderDailyView);
$('dailySchedule').addEventListener('click', event => {
  const btn = event.target.closest('.tiny-loc-btn');
  if (btn) {
    const { date, period, subject } = btn.dataset;
    openLocationDialog(date, period, subject);
  }
});
$('dailyTasks').addEventListener('click', event => { const task = event.target.closest('[data-id]'); if (task) openEdit(task.dataset.id); });
$('calendar').addEventListener('click', event => { const entry = event.target.closest('[data-id]'); if (entry) return openEdit(entry.dataset.id); const cell = event.target.closest('.day'); if (cell) openNew(cell.dataset.date); });
$('upcomingList').addEventListener('click', event => { const card = event.target.closest('[data-id]'); if (card) openEdit(card.dataset.id); });
$('period').addEventListener('change', () => { const recommended = daySubject($('date').value, $('period').value); if (recommended) $('subject').value = recommended; });
$('date').addEventListener('change', () => { const recommended = daySubject($('date').value, $('period').value); if (recommended) $('subject').value = recommended; });
$('image').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 1.5 * 1024 * 1024) { toast('사진은 1.5MB 이하로 선택해 주세요.'); event.target.value = ''; return; } editImage = await getFileAsData(file); previewImage(editImage); });
$('closeDialog').onclick = $('cancelBtn').onclick = () => $('entryDialog').close();
$('deleteBtn').onclick = async () => { if (!editingId || !confirm('이 일정을 삭제할까요?')) return; try { await deleteItem(editingId); $('entryDialog').close(); render(); toast('일정을 삭제했어요.'); } catch (err) { toast(err.message || '삭제하지 못했어요.'); } };
$('entryForm').addEventListener('submit', async event => { event.preventDefault(); if (!isAdmin) return; const save = $('saveBtn'); save.disabled = true; save.textContent = '저장 중…'; try { const id = $('entryId').value; await saveItem({ id, title: $('title').value, date: $('date').value, period: $('period').value, subject: $('subject').value, type: $('type').value, description: $('description').value, image: editImage, completed: id ? items.find(item => item.id === id)?.completed : false }); selectedDate = new Date(`${$('date').value}T12:00:00`); $('scheduleDate').value = $('date').value; $('entryDialog').close(); render(); toast('저장했어요.'); } catch (error) { toast(error.message || '저장하지 못했어요.'); } finally { save.disabled = false; save.textContent = '저장'; } });

if ($('locationForm')) {
  $('locationForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!isAdmin || !currentLocTarget) return;
    const val = $('locDialogInput').value;
    setDateLocation(currentLocTarget.date, currentLocTarget.period, val);
    $('locationDialog').close();
  });
}
if ($('resetLocBtn')) {
  $('resetLocBtn').onclick = () => {
    if (!isAdmin || !currentLocTarget) return;
    setDateLocation(currentLocTarget.date, currentLocTarget.period, null);
    $('locationDialog').close();
  };
}
if ($('closeLocDialog')) $('closeLocDialog').onclick = () => $('locationDialog').close();
if ($('cancelLocBtn')) $('cancelLocBtn').onclick = () => $('locationDialog').close();

const now = new Date();
$('todayLabel').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
$('scheduleDate').value = fmtDate(now);
updateAuthUI();
loadAllData().then(() => {
  setupRealtime();
  startFallbackTimer();
});

