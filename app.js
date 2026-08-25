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
const ADMIN_PASSWORD = '2010';
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
  1: ['이지은', '임태형', '심선덕', '금영충', '김석영'],
  2: ['안혜리', '임지은', '이경수', '최진현', '박문주'],
  3: ['박문주', '김세인', '정이슬', '김민소', '임지은'],
  4: ['이선미', '신명은', '금영충', '임지은', '정찬원'],
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
let dateTimetableOverrides = {};
let dbSchedule = { ...defaultSchedule };
let dbTeachers = { ...defaultTeachers };
let selectedDate = new Date(), editImage = '', editingId = null;

const $ = id => document.getElementById(id);
const fmtDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateText = iso => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${iso}T12:00:00`));
const escape = text => String(text).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function getEffectiveLesson(isoDate, period, dayOfWeek) {
  if (isoDate && period && dateTimetableOverrides[isoDate] && dateTimetableOverrides[isoDate][period]) {
    const ov = dateTimetableOverrides[isoDate][period];
    if (ov && (ov.subject !== undefined || ov.teacher !== undefined)) {
      return { subject: ov.subject || '', teacher: ov.teacher || '', isOverride: true };
    }
  }
  const dow = dayOfWeek !== undefined ? dayOfWeek : (isoDate ? new Date(`${isoDate}T12:00:00`).getDay() : 0);
  const subj = (period && dow >= 1 && dow <= 5) ? dbSchedule[period]?.[dow - 1] || '' : '';
  const tch = (period && dow >= 1 && dow <= 5) ? dbTeachers[period]?.[dow - 1] || '' : '';
  return { subject: subj, teacher: tch, isOverride: false };
}

function daySubject(iso, period) {
  const week = new Date(`${iso}T12:00:00`).getDay();
  return getEffectiveLesson(iso, period, week).subject;
}

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

async function loadDateTimetableOverridesData() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('timetable_overrides').select('*');
    if (error) throw error;
    const map = {};
    (data || []).forEach(row => {
      if (row.date && row.period) {
        if (!map[row.date]) map[row.date] = {};
        map[row.date][row.period] = {
          subject: row.subject || '',
          teacher: row.teacher || ''
        };
      }
    });
    dateTimetableOverrides = map;
  } catch (err) {
    console.error('timetable_overrides 로드 실패:', err);
  }
}

async function loadAllData() {
  await Promise.all([
    loadItemsData(),
    loadTimetableData(),
    loadDateTimetableOverridesData(),
    loadDefaultLocationsData(),
    loadDateLocationsData()
  ]);
  render();
}

async function loadAllDataSilently() {
  await Promise.all([
    loadItemsData(),
    loadTimetableData(),
    loadDateTimetableOverridesData(),
    loadDefaultLocationsData(),
    loadDateLocationsData()
  ]);
  render();
}

async function saveDefaultTimetable(newSchedule, newTeachers) {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다.');
    return;
  }
  dbSchedule = newSchedule;
  dbTeachers = newTeachers;

  if (supabaseClient) {
    const rows = [];
    Object.entries(newSchedule).forEach(([period, subjects]) => {
      subjects.forEach((subj, idx) => {
        const p = Number(period);
        const dow = idx + 1;
        const tch = newTeachers[p]?.[idx] || '';
        rows.push({
          id: `p${p}_d${dow}`,
          period: p,
          day_of_week: dow,
          subject: subj || '',
          teacher: tch || '',
          updated_at: new Date().toISOString()
        });
      });
    });
    try {
      const { error } = await supabaseClient.from('timetable').upsert(rows);
      if (error) throw error;
    } catch (e) {
      console.error('Supabase 기본 시간표 저장 오류:', e);
      toast('기본 시간표 저장에 실패했습니다.');
      return;
    }
  }
  render();
  toast('기본 시간표가 저장되었습니다.');
}

async function saveDateTimetableOverride(isoDate, periodOverrides) {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다.');
    return;
  }
  if (!dateTimetableOverrides[isoDate]) {
    dateTimetableOverrides[isoDate] = {};
  }

  const rowsToUpsert = [];
  const idsToDelete = [];

  Object.entries(periodOverrides).forEach(([period, data]) => {
    const p = Number(period);
    const id = `${isoDate}_${p}`;
    const subj = (data.subject || '').trim();
    const tch = (data.teacher || '').trim();

    if (!subj && !tch) {
      delete dateTimetableOverrides[isoDate][p];
      idsToDelete.push(id);
    } else {
      dateTimetableOverrides[isoDate][p] = { subject: subj, teacher: tch };
      rowsToUpsert.push({
        id: id,
        date: isoDate,
        period: p,
        subject: subj,
        teacher: tch,
        updated_at: new Date().toISOString()
      });
    }
  });

  if (Object.keys(dateTimetableOverrides[isoDate]).length === 0) {
    delete dateTimetableOverrides[isoDate];
  }

  if (supabaseClient) {
    try {
      if (idsToDelete.length) {
        await supabaseClient.from('timetable_overrides').delete().in('id', idsToDelete);
      }
      if (rowsToUpsert.length) {
        const { error } = await supabaseClient.from('timetable_overrides').upsert(rowsToUpsert);
        if (error) throw error;
      }
    } catch (e) {
      console.error('Supabase 특정 날짜 시간표 저장 오류:', e);
      toast('특정 날짜 시간표 저장에 실패했습니다.');
      return;
    }
  }
  render();
  toast(`${dateText(isoDate)} 시간표 변경이 저장되었습니다.`);
}

async function resetDateTimetableOverride(isoDate) {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다.');
    return;
  }
  if (!dateTimetableOverrides[isoDate]) {
    toast('변경 내역이 없습니다.');
    return;
  }
  delete dateTimetableOverrides[isoDate];
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('timetable_overrides').delete().eq('date', isoDate);
      if (error) throw error;
    } catch (e) {
      console.error('Supabase 특정 날짜 시간표 초기화 오류:', e);
      toast('시간표 초기화에 실패했습니다.');
      return;
    }
  }
  render();
  toast(`${dateText(isoDate)} 시간표가 기본 시간표로 복원되었습니다.`);
}

function applyNeisTimetableData(defaultRows, overrideRows) {
  if (Array.isArray(defaultRows)) {
    const scheduleMap = { 1: ['', '', '', '', ''], 2: ['', '', '', '', ''], 3: ['', '', '', '', ''], 4: ['', '', '', '', ''], 5: ['', '', '', '', ''], 6: ['', '', '', '', ''], 7: ['', '', '', '', ''] };
    const teacherMap = { 1: ['', '', '', '', ''], 2: ['', '', '', '', ''], 3: ['', '', '', '', ''], 4: ['', '', '', '', ''], 5: ['', '', '', '', ''], 6: ['', '', '', '', ''], 7: ['', '', '', '', ''] };
    defaultRows.forEach(row => {
      if (row.period >= 1 && row.period <= 7 && row.day_of_week >= 1 && row.day_of_week <= 5) {
        scheduleMap[row.period][row.day_of_week - 1] = row.subject || '';
        teacherMap[row.period][row.day_of_week - 1] = row.teacher || '';
      }
    });
    dbSchedule = scheduleMap;
    dbTeachers = teacherMap;
  }
  if (Array.isArray(overrideRows)) {
    const map = {};
    overrideRows.forEach(row => {
      if (row.date && row.period) {
        if (!map[row.date]) map[row.date] = {};
        map[row.date][row.period] = { subject: row.subject || '', teacher: row.teacher || '' };
      }
    });
    dateTimetableOverrides = map;
  }
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
    try { supabaseClient.removeChannel(realtimeChannel); } catch (e) { }
  }

  try {
    realtimeChannel = supabaseClient
      .channel('school-planner-realtime-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assessments' }, () => loadAllDataSilently())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timetable' }, () => loadAllDataSilently())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timetable_overrides' }, () => loadAllDataSilently())
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
    try { supabaseClient.removeChannel(realtimeChannel); } catch (e) { }
  }
});

function updateAuthUI() {
  const authBtn = $('authBtn');
  const newBtn = $('newEntryBtn');
  const editDefaultBtn = $('editDefaultTimetableBtn');
  const editDateBtn = $('editDateTimetableBtn');
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
  if (editDefaultBtn) {
    editDefaultBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  }
  if (editDateBtn) {
    editDateBtn.style.display = isAdmin ? 'inline-flex' : 'none';
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
function renderUpcoming() {
  const monthPrefix = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
  const monthItems = items.filter(item => item.date.startsWith(monthPrefix)).sort((a, b) => a.date.localeCompare(b.date) || Number(a.period || 99) - Number(b.period || 99));
  $('openCount').textContent = `${monthItems.length}개 일정`;
  if (!monthItems.length) {
    $('upcomingList').innerHTML = '<p class="nothing">이번 달 일정이 없어요.</p>';
    return;
  }
  $('upcomingList').innerHTML = monthItems.slice(0, 8).map(item => {
    const borderColor = subjectColors[item.subject] || '#506cfe';
    return `<article class="task-card" data-id="${item.id}" style="border-left-color:${borderColor}">
      <div class="task-card-header">
        <span class="task-type-badge type-${item.type || '과제'}">${escape(item.type || '과제')}</span>
        <span class="task-subject-pill">${escape(item.subject)}</span>
      </div>
      <h3 class="task-title">${escape(item.title)}</h3>
      <div class="task-meta">${dateText(item.date)}${item.period ? ' · ' + item.period + '교시' : ''}</div>
    </article>`;
  }).join('');
}

function renderDailyView() {
  const iso = $('scheduleDate').value || fmtDate(new Date()), date = new Date(`${iso}T12:00:00`), weekday = date.getDay(), today = fmtDate(new Date());
  $('dailyTitle').textContent = iso === today ? '오늘의 수업' : `${date.getMonth() + 1}월 ${date.getDate()}일 수업`;
  const holiday = holidays[iso];
  const dayItems = items.filter(item => item.date === iso).sort((a, b) => Number(a.period || 99) - Number(b.period || 99));
  const linkedItemIds = new Set();

  if (holiday) {
    $('dailySchedule').innerHTML = `<div class="daily-holiday">${holiday} · 수업이 없어요</div>`;
  } else if (weekday === 0 || weekday === 6) {
    $('dailySchedule').innerHTML = '<p class="daily-empty">주말에는 정규 수업이 없어요.</p>';
  } else {
    const periodMap = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };

    // Priority 1: Date + Period match
    dayItems.forEach(item => {
      if (item.period && Number(item.period) >= 1 && Number(item.period) <= 7) {
        const pNum = Number(item.period);
        periodMap[pNum].push(item);
        linkedItemIds.add(item.id);
      }
    });

    // Priority 2: Date + Subject match if period is missing (using getEffectiveLesson subject)
    dayItems.forEach(item => {
      if (!linkedItemIds.has(item.id) && item.subject) {
        for (let p = 1; p <= 7; p++) {
          const lesson = getEffectiveLesson(iso, p, weekday);
          if (lesson.subject && lesson.subject === item.subject) {
            periodMap[p].push(item);
            linkedItemIds.add(item.id);
          }
        }
      }
    });

    $('dailySchedule').innerHTML = Object.entries(dbSchedule).map(([period]) => {
      const pNum = Number(period);
      const lesson = getEffectiveLesson(iso, pNum, weekday);
      const subject = lesson.subject;
      const teacher = lesson.teacher;
      if (!subject && !teacher) return '';

      const loc = getLocation(iso, pNum, subject);
      const isLocOverride = isDateOverride(iso, pNum);
      const periodTasks = periodMap[pNum] || [];

      return `<div class="daily-row">
        <span class="daily-period">${pNum}교시</span>
        <div class="daily-subject-cell">
          <div class="daily-subject ${periodTasks.length ? 'has-tasks' : ''}" style="border-color:${subjectColors[subject] || '#bdc3ce'}">
            <div class="daily-subject-header">
              <div class="daily-subject-main-info">
                <span class="daily-subject-title">${escape(subject || '수업')}</span>
                <small class="daily-teacher-info">${teacher ? escape(teacher) + ' 선생님' : '담당 선생님'}${lesson.isOverride ? ` <span class="lesson-override-badge">⏰ 시간표 변경</span>` : ''}${loc ? ` <span class="daily-loc-badge ${isLocOverride ? 'override' : ''}">📍 ${escape(loc)}</span>` : ''}</small>
              </div>
              ${isAdmin ? `<button type="button" class="tiny-loc-btn" data-date="${iso}" data-period="${pNum}" data-subject="${escape(subject)}" title="해당 날짜 장소 변경">📍 장소 변경</button>` : ''}
            </div>
            ${periodTasks.length ? `
              <div class="daily-period-tasks">
                ${periodTasks.map(item => {
        const iconMap = { '수행평가': '📝', '과제': '📌', '시험': '✏️', '기타': '🏷️' };
        const icon = iconMap[item.type] || '📌';
        return `
                    <div class="period-task-chip type-${item.type || '과제'}" data-id="${item.id}" title="클릭하여 일정 상세 보기">
                      <span class="task-chip-badge">${icon} ${escape(item.type || '과제')}</span>
                      <span class="task-chip-title">${escape(item.title)}</span>
                    </div>
                  `;
      }).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // Priority 3: Unlinked items
  const unlinkedItems = dayItems.filter(item => !linkedItemIds.has(item.id));
  if (unlinkedItems.length) {
    $('dailyTasks').innerHTML = `<h3>오늘의 기타 / 교시 미지정 수행평가 · 과제</h3>${unlinkedItems.map(item => `
      <div class="daily-task" data-id="${item.id}" title="클릭하여 일정 상세 보기">
        ${item.period ? item.period + '교시 · ' : ''}${item.subject ? '[' + escape(item.subject) + '] ' : ''}${escape(item.title)}
      </div>
    `).join('')}`;
  } else {
    $('dailyTasks').innerHTML = '';
  }
}

function getWeekDays(refDate = new Date()) {
  const d = new Date(refDate);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);

  const weekDates = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    weekDates.push(fmtDate(date));
  }
  return weekDates;
}

function renderTimetable() {
  const container = $('timetableList');
  if (!container) return;

  const refDateInput = $('scheduleDate')?.value;
  const refDate = refDateInput ? new Date(`${refDateInput}T12:00:00`) : selectedDate;
  const weekDates = getWeekDays(refDate);
  const todayStr = fmtDate(new Date());

  const daysLabel = ['월', '화', '수', '목', '금'];

  const headerHtml = `<div class="schedule-header">` +
    `<span class="schedule-header-period-spacer">교시</span>` +
    daysLabel.map((dayName, idx) => {
      const iso = weekDates[idx];
      const [, m, d] = iso.split('-');
      const isToday = (iso === todayStr);
      return `<span class="schedule-header-day ${isToday ? 'is-today' : ''}">${dayName}<small>(${Number(m)}/${Number(d)})</small></span>`;
    }).join('') +
    `</div>`;

  const rowsHtml = Object.keys(dbSchedule).map(periodStr => {
    const period = Number(periodStr);
    const cellsHtml = weekDates.map((isoDate, dowIdx) => {
      const dow = dowIdx + 1;
      const lesson = getEffectiveLesson(isoDate, period, dow);
      const subject = lesson.subject;
      const teacher = lesson.teacher;
      const loc = getLocation(isoDate, period, subject);
      const isLocOverride = isDateOverride(isoDate, period);
      const isToday = (isoDate === todayStr);

      const subjColor = subjectColors[subject] || '#bdc3ce';
      const classes = [
        'schedule-cell',
        lesson.isOverride ? 'has-override' : '',
        isToday ? 'is-today' : '',
        (!subject && !teacher) ? 'empty-cell' : ''
      ].filter(Boolean).join(' ');

      const titleAttr = `${escape(subject || '수업')}${teacher ? ' (' + escape(teacher) + ' 선생님)' : ''}${lesson.isOverride ? ' [⏰ 시간표 변경됨]' : ''}${loc ? ' [📍 ' + escape(loc) + ']' : ''}`;

      return `
        <div class="${classes}" title="${titleAttr}" style="border-left-color:${subjColor}">
          ${lesson.isOverride ? `<small class="schedule-override-tag">🔄 변경</small>` : ''}
          <span class="schedule-cell-subject">${escape(subject || '—')}</span>
          ${teacher ? `<small class="schedule-cell-teacher">${escape(teacher)} 선생님</small>` : ''}
          ${loc ? `<small class="schedule-loc-tag ${isLocOverride ? 'override' : ''}">📍 ${escape(loc)}</small>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="schedule-row">
        <span class="schedule-period">${period}교시</span>
        ${cellsHtml}
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="timetable-scroll-wrapper">${headerHtml}${rowsHtml}</div>`;

  if ($('subjects')) {
    $('subjects').innerHTML = Object.keys(subjectColors).map(subject => `<option value="${subject}">`).join('');
  }
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

function renderDefaultTimetableEditGrid() {
  const container = $('defaultTimetableEditGrid');
  if (!container) return;

  const days = ['월', '화', '수', '목', '금'];
  let html = `<div class="timetable-edit-header">교시</div>` + days.map(d => `<div class="timetable-edit-header">${d}</div>`).join('');

  for (let p = 1; p <= 7; p++) {
    html += `<div class="timetable-edit-header">${p}교시</div>`;
    for (let dow = 1; dow <= 5; dow++) {
      const subj = dbSchedule[p]?.[dow - 1] || '';
      const tch = dbTeachers[p]?.[dow - 1] || '';
      html += `
        <div class="timetable-edit-cell">
          <input class="subject-input" data-period="${p}" data-dow="${dow}" value="${escape(subj)}" placeholder="과목" list="subjects" />
          <input class="teacher-input" data-period="${p}" data-dow="${dow}" value="${escape(tch)}" placeholder="선생님" />
        </div>
      `;
    }
  }
  container.innerHTML = html;
}

function openDefaultTimetableDialog() {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다. 상단의 [🔑 등록 권한] 버튼을 클릭해 주세요.');
    return;
  }
  renderDefaultTimetableEditGrid();
  $('defaultTimetableDialog').showModal();
}

function renderDateTimetableEditGrid(isoDate) {
  const container = $('dateTimetableEditGrid');
  if (!container) return;

  const week = new Date(`${isoDate}T12:00:00`).getDay();
  let html = '';
  for (let p = 1; p <= 7; p++) {
    const defaultSubj = (week >= 1 && week <= 5) ? dbSchedule[p]?.[week - 1] || '' : '';
    const defaultTch = (week >= 1 && week <= 5) ? dbTeachers[p]?.[week - 1] || '' : '';

    const override = dateTimetableOverrides[isoDate]?.[p];
    const activeSubj = override ? override.subject : '';
    const activeTch = override ? override.teacher : '';

    html += `
      <div class="date-timetable-row">
        <span class="date-timetable-period">${p}교시</span>
        <input class="subject-input" data-period="${p}" value="${escape(activeSubj)}" placeholder="기본: ${escape(defaultSubj || '없음')}" list="subjects" />
        <input class="teacher-input" data-period="${p}" value="${escape(activeTch)}" placeholder="기본: ${escape(defaultTch || '없음')}" />
      </div>
    `;
  }
  container.innerHTML = html;
  if ($('overrideDateNotice')) {
    $('overrideDateNotice').textContent = `${dateText(isoDate)} 교시별 수업을 변경합니다. (빈 칸으로 두면 기본 시간표 사용)`;
  }
}

function openDateTimetableDialog(isoDate = '') {
  if (!isAdmin) {
    toast('등록 권한이 필요합니다. 상단의 [🔑 등록 권한] 버튼을 클릭해 주세요.');
    return;
  }
  const dateToUse = isoDate || $('scheduleDate').value || fmtDate(new Date());
  if ($('overrideDateInput')) $('overrideDateInput').value = dateToUse;
  renderDateTimetableEditGrid(dateToUse);
  $('dateTimetableDialog').showModal();
}

function previewImage(src) { $('imagePreview').innerHTML = src ? `<img alt="첨부 사진 미리보기" src="${src}">` : ''; }
function getFileAsData(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

function goToTodayView() {
  $('plannerGrid').className = 'planner-grid view-today';
  document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === 'today'));
  const now = new Date();
  selectedDate = now;
  $('scheduleDate').value = fmtDate(now);
  renderCalendar();
  renderDailyView();
}

if ($('brandBtn')) {
  $('brandBtn').addEventListener('click', (e) => {
    e.preventDefault();
    goToTodayView();
  });
}

if ($('authBtn')) $('authBtn').onclick = handleAuthToggle;
if ($('editDefaultTimetableBtn')) $('editDefaultTimetableBtn').onclick = () => openDefaultTimetableDialog();
if ($('editDateTimetableBtn')) $('editDateTimetableBtn').onclick = () => openDateTimetableDialog();
$('newEntryBtn').onclick = () => openNew();
$('prevMonth').onclick = () => { selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1); render(); };
$('nextMonth').onclick = () => { selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1); render(); };
document.querySelectorAll('.view-tab').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.view;
  if (view === 'today') {
    goToTodayView();
  } else {
    $('plannerGrid').className = `planner-grid view-${view}`;
    document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    if (view === 'timetable') {
      renderTimetable();
    }
  }
}));
$('scheduleToday').onclick = () => { $('scheduleDate').value = fmtDate(new Date()); renderDailyView(); };
$('scheduleDate').addEventListener('change', renderDailyView);
$('dailySchedule').addEventListener('click', event => {
  const btn = event.target.closest('.tiny-loc-btn');
  if (btn) {
    const { date, period, subject } = btn.dataset;
    openLocationDialog(date, period, subject);
    return;
  }
  const task = event.target.closest('[data-id]');
  if (task) {
    openEdit(task.dataset.id);
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

if ($('defaultTimetableForm')) {
  $('defaultTimetableForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!isAdmin) return;

    const newSchedule = { 1: ['', '', '', '', ''], 2: ['', '', '', '', ''], 3: ['', '', '', '', ''], 4: ['', '', '', '', ''], 5: ['', '', '', '', ''], 6: ['', '', '', '', ''], 7: ['', '', '', '', ''] };
    const newTeachers = { 1: ['', '', '', '', ''], 2: ['', '', '', '', ''], 3: ['', '', '', '', ''], 4: ['', '', '', '', ''], 5: ['', '', '', '', ''], 6: ['', '', '', '', ''], 7: ['', '', '', '', ''] };

    document.querySelectorAll('#defaultTimetableEditGrid .timetable-edit-cell').forEach(cell => {
      const subjInput = cell.querySelector('.subject-input');
      const tchInput = cell.querySelector('.teacher-input');
      if (subjInput && tchInput) {
        const p = Number(subjInput.dataset.period);
        const dow = Number(subjInput.dataset.dow);
        newSchedule[p][dow - 1] = (subjInput.value || '').trim();
        newTeachers[p][dow - 1] = (tchInput.value || '').trim();
      }
    });

    await saveDefaultTimetable(newSchedule, newTeachers);
    $('defaultTimetableDialog').close();
  });
}

if ($('closeDefaultTimetableDialog')) $('closeDefaultTimetableDialog').onclick = () => $('defaultTimetableDialog').close();
if ($('cancelDefaultTimetableBtn')) $('cancelDefaultTimetableBtn').onclick = () => $('defaultTimetableDialog').close();

if ($('overrideDateInput')) {
  $('overrideDateInput').addEventListener('change', (e) => {
    if (e.target.value) renderDateTimetableEditGrid(e.target.value);
  });
}

if ($('dateTimetableForm')) {
  $('dateTimetableForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!isAdmin) return;

    const isoDate = $('overrideDateInput').value;
    if (!isoDate) return;

    const periodOverrides = {};
    document.querySelectorAll('#dateTimetableEditGrid .date-timetable-row').forEach(row => {
      const subjInput = row.querySelector('.subject-input');
      const tchInput = row.querySelector('.teacher-input');
      if (subjInput && tchInput) {
        const p = Number(subjInput.dataset.period);
        periodOverrides[p] = {
          subject: (subjInput.value || '').trim(),
          teacher: (tchInput.value || '').trim()
        };
      }
    });

    await saveDateTimetableOverride(isoDate, periodOverrides);
    $('dateTimetableDialog').close();
  });
}

if ($('resetDateTimetableBtn')) {
  $('resetDateTimetableBtn').onclick = async () => {
    if (!isAdmin) return;
    const isoDate = $('overrideDateInput').value;
    if (!isoDate) return;
    await resetDateTimetableOverride(isoDate);
    $('dateTimetableDialog').close();
  };
}

if ($('closeDateTimetableDialog')) $('closeDateTimetableDialog').onclick = () => $('dateTimetableDialog').close();
if ($('cancelDateTimetableBtn')) $('cancelDateTimetableBtn').onclick = () => $('dateTimetableDialog').close();

const now = new Date();
$('todayLabel').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
$('scheduleDate').value = fmtDate(now);
updateAuthUI();
loadAllData().then(() => {
  setupRealtime();
  startFallbackTimer();
});

