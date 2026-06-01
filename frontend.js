import {
  firebaseReady,
  onAuthChange,
  saveRestaurant,
  signInWithKakao,
  signOutUser,
  unsaveRestaurant,
  watchSavedRestaurants
} from './firebase-client.js';

// 지도 버튼 → 지역 키워드 매핑 (region 필드 prefix 매칭)
const MAP_REGIONS = {
  '서울': ['서울'],
  '경기/인천': ['경기', '인천', '수원', '용인', '안양', '부천', '시흥', '의왕', '군포', '광명', '김포', '파주', '일산', '고양', '의정부', '구리', '남양주', '판교', '안산', '화성', '평택', '안성', '송탄', '동두천', '양주', '양평', '하남', '오산', '과천', '가평', '포천', '연천', '청평'],
  '강원': ['강원', '강릉', '춘천', '속초', '원주', '양양', '고성', '인제', '동해', '삼척', '태백', '영월', '정선', '철원', '홍천', '횡성', '평창', '용평', '화천', '주문진'],
  '충청/대전': ['대전', '충남', '충북', '청주', '충주', '제천', '천안', '아산', '당진', '서산', '예산', '홍성', '보령', '서천', '논산', '공주', '부여', '조치원', '음성', '진천', '보은', '옥천', '영동', '세종'],
  '전라/광주': ['광주', '전남', '전북', '전주', '순천', '여수', '목포', '순창', '담양', '나주', '강진', '영광', '함평', '광양', '군산', '익산', '부안', '남원', '임실', '장수', '고창', '정읍', '김제', '완도', '진도', '해남', '영암', '구례', '보성', '고흥'],
  '경북/대구': ['대구', '경북', '구미', '경산', '경주', '포항', '안동', '영주', '영천', '상주', '문경', '의성', '청송', '영양', '영덕', '청도', '고령', '성주', '칠곡', '예천', '봉화', '울진'],
  '경남/부산/울산': ['부산', '울산', '경남', '창원', '마산', '진해', '진주', '통영', '거제', '남해', '사천', '밀양', '양산', '김해', '창녕', '함안', '의령', '합천', '거창', '함양', '산청'],
  '제주': ['제주', '모슬포'],
};

const state = {
  rows: [],
  config: {},
  user: null,
  savedIds: new Set(),
  search: '',
  mapRegion: ''
};

const el = {
  searchInput: document.querySelector('#searchInput'),
  list: document.querySelector('#restaurantList'),
  emptyState: document.querySelector('#emptyState'),
  emptyMessage: document.querySelector('#emptyMessage'),
  emptyResetAll: document.querySelector('#emptyResetAll'),
  emptyClearSearch: document.querySelector('#emptyClearSearch'),
  statusBar: document.querySelector('#statusBar'),
  summaryTotal: document.querySelector('#summaryTotal'),
  summaryVisible: document.querySelector('#summaryVisible'),
  scopeLabel: document.querySelector('#scopeLabel'),
  scopeValue: document.querySelector('#scopeValue'),
  lastUpdated: document.querySelector('#lastUpdated'),
  authStatus: document.querySelector('#authStatus'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  savedLink: document.querySelector('#savedLink'),
  mapButtons: [...document.querySelectorAll('.map-btn')],
  mapClearBtn: document.querySelector('#mapClearBtn'),
  loginToast: document.querySelector('#loginToast'),
  toastLoginBtn: document.querySelector('#toastLoginBtn'),
  toastCloseBtn: document.querySelector('#toastCloseBtn'),
};

// ──────────────────────────────────────────
// 필터 로직
// 핵심: 검색어가 있으면 → 전체 데이터에서 검색 (지역 필터 무시)
//        검색어 없으면 → 지역 필터만 적용
// ──────────────────────────────────────────

function getRegionGroup(row) {
  for (const [group, keywords] of Object.entries(MAP_REGIONS)) {
    if (keywords.some((k) => row.region.startsWith(k))) return group;
  }
  return null;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sortRows(rows) {
  return [...rows].sort((a, b) =>
    `${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`, 'ko')
  );
}

function getFilteredRows() {
  const hasSearch = state.search.trim().length > 0;
  const query = normalize(state.search);

  return sortRows(state.rows).filter((row) => {
    if (hasSearch) {
      // 검색어 있으면 → 전체에서 검색 (지역 무시)
      const text = normalize(
        `${row.region} ${row.name} ${row.menu} ${row.remark} ${row.verification_note}`
      );
      return text.includes(query);
    }
    // 검색어 없으면 → 지역 필터만
    if (state.mapRegion) {
      const keywords = MAP_REGIONS[state.mapRegion] || [];
      return keywords.some((k) => row.region.startsWith(k));
    }
    return true;
  });
}

// ──────────────────────────────────────────
// 렌더링
// ──────────────────────────────────────────

function renderAuth() {
  const ready = firebaseReady();
  if (!ready) {
    // Firebase 미설정 시 로그인 버튼만 조용히 숨김 (사용자에게 오류 노출 안 함)
    el.authStatus.textContent = '';
    el.authStatus.hidden = true;
    el.loginButton.hidden = true;
    el.logoutButton.hidden = true;
    el.savedLink.hidden = true;
    return;
  }

  el.authStatus.hidden = false;
  if (state.user) {
    const label = state.user.displayName || state.user.uid.replace('kakao:', '');
    el.authStatus.textContent = `${label}님`;
    el.loginButton.hidden = true;
    el.logoutButton.hidden = false;
    el.savedLink.hidden = false;
  } else {
    el.authStatus.textContent = '로그인 없이 둘러보는 중';
    el.loginButton.hidden = false;
    el.loginButton.disabled = false;
    el.loginButton.textContent = '카카오 로그인';
    el.logoutButton.hidden = true;
    el.savedLink.hidden = true;
  }
}

function renderSummary(filteredCount) {
  const total = state.rows.length;
  const hasSearch = state.search.trim().length > 0;

  el.summaryTotal.textContent = total;
  el.summaryVisible.textContent = filteredCount;

  if (hasSearch) {
    el.scopeLabel.textContent = '검색 범위';
    el.scopeValue.textContent = '전체 지역';
  } else if (state.mapRegion) {
    el.scopeLabel.textContent = '선택 지역';
    el.scopeValue.textContent = state.mapRegion;
  } else {
    el.scopeLabel.textContent = '선택 지역';
    el.scopeValue.textContent = '전체 지역';
  }
}

function renderStatusBar() {
  const hasSearch = state.search.trim().length > 0;

  if (hasSearch) {
    el.statusBar.textContent = `전체 지역에서 "${state.search}"을 검색 중입니다.`;
  } else if (state.mapRegion) {
    el.statusBar.textContent = `${state.mapRegion} 지역 맛집을 보고 있습니다.`;
  } else {
    el.statusBar.textContent = '전체 지역 맛집을 보고 있습니다.';
  }
}

function renderEmptyState(rows) {
  const hasSearch = state.search.trim().length > 0;
  const isEmpty = rows.length === 0;

  el.emptyState.hidden = !isEmpty;
  if (!isEmpty) {
    if (hasSearch) {
      el.emptyMessage.textContent = `"${state.search}"과 일치하는 맛집이 없습니다. 상호명, 지역명, 메뉴명으로 다시 검색해보세요.`;
    } else if (state.mapRegion) {
      el.emptyMessage.textContent = `${state.mapRegion} 지역에 등록된 맛집이 아직 없습니다. 다른 지역을 선택해보세요.`;
    } else {
      el.emptyMessage.textContent = '등록된 맛집이 없습니다.';
    }
    el.emptyClearSearch.hidden = !hasSearch;
  }
}

function createReportIssueUrl(row) {
  const baseUrl = state.config.githubIssuesUrl;
  if (!baseUrl) return '';
  const title = `[폐업 신고] ${row.region} ${row.name}`;
  const body = [
    '## 폐업 신고',
    '',
    `- 식당 ID: ${row.id}`,
    `- 지역: ${row.region}`,
    `- 식당명: ${row.name}`,
    `- 대표 메뉴: ${row.menu}`,
    '',
    '## 확인한 근거',
    '',
    '- 예: 현장 방문, 지도 서비스 폐업 표시, 전화 확인 등',
    ''
  ].join('\n');
  const url = new URL(baseUrl);
  url.searchParams.set('title', title);
  url.searchParams.set('body', body);
  url.searchParams.set('labels', '폐업신고');
  return url.toString();
}

function groupByRegion(rows) {
  return rows.reduce((groups, row) => {
    const region = row.region || '지역 미상';
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(row);
    return groups;
  }, new Map());
}

function renderList() {
  const rows = getFilteredRows();
  renderStatusBar();
  renderSummary(rows.length);
  renderEmptyState(rows);

  el.list.innerHTML = [...groupByRegion(rows).entries()]
    .map(([region, items]) => {
      const cards = items
        .map((row) => {
          const isSaved = state.savedIds.has(row.id);
          const naverUrl = (row.links && row.links.naver)
            ? row.links.naver
            : `https://search.naver.com/search.naver?query=${encodeURIComponent([row.region, row.name, row.menu].filter(Boolean).join(' '))}`;
          const reportUrl = createReportIssueUrl(row);

          return `
            <article class="restaurant-item">
              <div class="item-header">
                <div class="item-title-row">
                  <h3>${escapeHtml(row.name)}</h3>
                  <span class="region-badge">${escapeHtml(row.region)}</span>
                </div>
                <p class="menu-text">${escapeHtml(row.menu || '대표 메뉴 확인 필요')}</p>
                ${row.remark || row.business_hours !== '확인 필요' ? `<p class="item-note">${escapeHtml(row.remark || row.business_hours || '')}</p>` : ''}
              </div>
              <div class="item-actions">
                <button
                  class="btn-save ${isSaved ? 'saved' : ''}"
                  type="button"
                  data-action="save"
                  data-id="${escapeHtml(row.id)}">
                  ${isSaved ? '저장됨 ✓' : '저장'}
                </button>
                <a class="btn-naver" href="${escapeHtml(naverUrl)}" target="_blank" rel="noopener noreferrer">네이버에서 확인</a>
                ${reportUrl ? `<a class="btn-report" href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer">폐업 신고</a>` : ''}
              </div>
            </article>
          `;
        })
        .join('');

      return `
        <section class="region-group">
          <header>
            <h2>${escapeHtml(region)}</h2>
            <span>${items.length}곳</span>
          </header>
          <div class="region-items">${cards}</div>
        </section>
      `;
    })
    .join('');
}

async function loadRestaurants() {
  const [response, configResponse] = await Promise.all([
    fetch('./data.json', { cache: 'no-store' }),
    fetch('./site.config.json', { cache: 'no-store' }).catch(() => null)
  ]);
  if (!response.ok) throw new Error(`data.json을 불러오지 못했습니다. (${response.status})`);

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('data.json은 배열이어야 합니다.');

  state.rows = data;
  state.config = configResponse?.ok ? await configResponse.json() : {};

  const lastVerified = data.map((r) => r.last_verified).filter(Boolean).sort().at(-1);
  el.lastUpdated.textContent = lastVerified ? `최근 검증 ${lastVerified}` : '검증일 없음';
  el.summaryTotal.textContent = data.length;

  renderList();
}

// ──────────────────────────────────────────
// 이벤트
// ──────────────────────────────────────────

el.searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderList();
});

// 지도 지역 버튼: 클릭 시 검색어 초기화 후 해당 지역 표시
for (const btn of el.mapButtons) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.map;
    const wasActive = state.mapRegion === key;

    // 검색어 초기화
    if (state.search) {
      state.search = '';
      el.searchInput.value = '';
    }

    state.mapRegion = wasActive ? '' : key;

    for (const b of el.mapButtons) {
      b.classList.toggle('active', b.dataset.map === state.mapRegion);
    }
    el.mapClearBtn.hidden = !state.mapRegion;
    renderList();
  });
}

el.mapClearBtn.addEventListener('click', () => {
  state.mapRegion = '';
  state.search = '';
  el.searchInput.value = '';
  for (const b of el.mapButtons) b.classList.remove('active');
  el.mapClearBtn.hidden = true;
  renderList();
});

el.emptyResetAll.addEventListener('click', () => {
  state.mapRegion = '';
  state.search = '';
  el.searchInput.value = '';
  for (const b of el.mapButtons) b.classList.remove('active');
  el.mapClearBtn.hidden = true;
  renderList();
});

el.emptyClearSearch.addEventListener('click', () => {
  state.search = '';
  el.searchInput.value = '';
  renderList();
});

// 저장 버튼 이벤트
el.list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="save"]');
  if (!button) return;

  if (!state.user) {
    showLoginToast();
    return;
  }

  const restaurantId = button.dataset.id;
  const restaurant = state.rows.find((r) => r.id === restaurantId);
  if (!restaurant) return;

  try {
    if (state.savedIds.has(restaurantId)) {
      await unsaveRestaurant(state.user, restaurantId);
    } else {
      await saveRestaurant(state.user, restaurant);
    }
  } catch (error) {
    alert(error.message);
  }
});

// 로그인 버튼
el.loginButton.addEventListener('click', async () => {
  el.loginButton.disabled = true;
  el.loginButton.textContent = '로그인 중…';
  try {
    await signInWithKakao();
  } catch (error) {
    alert(error.message);
    renderAuth();
  }
});

el.logoutButton.addEventListener('click', async () => {
  await signOutUser();
});

// 토스트
function showLoginToast() {
  el.loginToast.hidden = false;
}

el.toastCloseBtn.addEventListener('click', () => {
  el.loginToast.hidden = true;
});

el.toastLoginBtn.addEventListener('click', async () => {
  el.loginToast.hidden = true;
  el.loginButton.click();
});

// Firebase Auth 상태 감지
onAuthChange(async (user) => {
  state.user = user;
  renderAuth();
  await watchSavedRestaurants(user, (savedIds) => {
    state.savedIds = savedIds;
    renderList();
  });
});

// 초기 로드
loadRestaurants().catch((error) => {
  el.emptyState.hidden = false;
  el.emptyMessage.textContent = error.message;
});
