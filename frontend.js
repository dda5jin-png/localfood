import {
  createClosureReport,
  firebaseReady,
  onAuthChange,
  rateRestaurant,
  saveRestaurant,
  signInWithKakao,
  signOutUser,
  unsaveRestaurant,
  watchMyRatings,
  watchSavedRestaurants
} from './firebase-client.js';

const state = {
  rows: [],
  config: {},
  user: null,
  savedIds: new Set(),
  myRatings: new Map(),
  search: '',
  region: '',
  status: ''
};

const elements = {
  totalCount: document.querySelector('#totalCount'),
  lastUpdated: document.querySelector('#lastUpdated'),
  summaryTotal: document.querySelector('#summaryTotal'),
  summaryOpen: document.querySelector('#summaryOpen'),
  summaryClosed: document.querySelector('#summaryClosed'),
  searchInput: document.querySelector('#searchInput'),
  regionFilter: document.querySelector('#regionFilter'),
  list: document.querySelector('#restaurantList'),
  emptyState: document.querySelector('#emptyState'),
  authStatus: document.querySelector('#authStatus'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  statusButtons: [...document.querySelectorAll('[data-status]')]
};

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function formatStatus(status) {
  if (status === 'EXCLUDED') return '제외';
  return status === 'CLOSED' ? '폐업' : '영업 중';
}

function statusClass(status) {
  if (status === 'EXCLUDED') return 'excluded';
  return status === 'CLOSED' ? 'closed' : 'open';
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
  return [...rows].sort((a, b) => {
    const order = { OPEN: 0, CLOSED: 1, EXCLUDED: 2 };
    const statusOrder = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (statusOrder !== 0) return statusOrder;
    return `${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`, 'ko');
  });
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
    `- 현재 상태: ${formatStatus(row.status)}`,
    `- 마지막 검증일: ${row.last_verified || '-'}`,
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

function getFilteredRows() {
  const query = normalize(state.search);
  return sortRows(state.rows).filter((row) => {
    const text = normalize(
      `${row.region} ${row.name} ${row.menu} ${row.business_hours} ${row.holiday_note} ${row.remark} ${row.verification_note}`
    );
    const matchesSearch = !query || text.includes(query);
    const matchesRegion = !state.region || row.region === state.region;
    const matchesStatus = !state.status || row.status === state.status;
    return matchesSearch && matchesRegion && matchesStatus;
  });
}

function formatHours(row) {
  const hours = row.business_hours || '확인 필요';
  const holiday = row.holiday_note ? ` / ${row.holiday_note}` : '';
  return `${hours}${holiday}`;
}

function formatRating(row) {
  if (row.rating_status === 'EXCLUDED_ONE_POINT_QUORUM') {
    return `제외: 1점 ${row.rating_one_count || 0}명`;
  }
  if (row.rating_count >= 30) {
    return `${Number(row.rating_average || 0).toFixed(1)}점 / ${row.rating_count}명`;
  }
  return `평가 ${row.rating_count || 0}/30명`;
}

function ratingOptions(selectedScore) {
  const options = ['<option value="">내 점수</option>'];
  for (let score = 10; score >= 1; score -= 1) {
    options.push(`<option value="${score}" ${selectedScore === score ? 'selected' : ''}>${score}점</option>`);
  }
  return options.join('');
}

function groupByRegion(rows) {
  return rows.reduce((groups, row) => {
    const region = row.region || '지역 미상';
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(row);
    return groups;
  }, new Map());
}

function getLinks(row) {
  const links = row.links || {};
  const naver = links.naver || `https://search.naver.com/search.naver?query=${encodeURIComponent(
    [row.region, row.name, row.menu].filter(Boolean).join(' ')
  )}`;
  return {
    naver,
    kakao: links.kakao || ''
  };
}

function getRestaurantById(id) {
  return state.rows.find((row) => row.id === id);
}

function renderAuth() {
  if (!firebaseReady()) {
    elements.authStatus.textContent = 'Firebase 설정 필요';
    elements.loginButton.disabled = true;
    elements.loginButton.textContent = '설정 대기';
    elements.logoutButton.hidden = true;
    return;
  }

  if (state.user) {
    const label = state.user.displayName || state.user.uid.replace('kakao:', '');
    elements.authStatus.textContent = `${label}님`;
    elements.loginButton.hidden = true;
    elements.logoutButton.hidden = false;
  } else {
    elements.authStatus.textContent = '로그인 없이 둘러보는 중';
    elements.loginButton.hidden = false;
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = '카카오 로그인';
    elements.logoutButton.hidden = true;
  }
}

function renderSummary() {
  const total = state.rows.length;
  const open = state.rows.filter((row) => row.status === 'OPEN').length;
  const closed = state.rows.filter((row) => row.status === 'CLOSED').length;
  const lastVerified = state.rows
    .map((row) => row.last_verified)
    .filter(Boolean)
    .sort()
    .at(-1);

  elements.totalCount.textContent = `${total}곳`;
  elements.lastUpdated.textContent = lastVerified ? `최근 검증 ${lastVerified}` : '검증일 없음';
  elements.summaryTotal.textContent = total;
  elements.summaryOpen.textContent = open;
  elements.summaryClosed.textContent = closed;
}

function renderRegions() {
  const regions = [...new Set(state.rows.map((row) => row.region).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ko')
  );

  elements.regionFilter.innerHTML = [
    '<option value="">전체 지역</option>',
    ...regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)
  ].join('');
}

function renderList() {
  const rows = getFilteredRows();
  elements.emptyState.hidden = rows.length > 0;
  elements.list.innerHTML = [...groupByRegion(rows).entries()]
    .map(([region, items]) => {
      const cards = items
        .map((row) => {
          const links = getLinks(row);
          const reportUrl = createReportIssueUrl(row);
          const isSaved = state.savedIds.has(row.id);
          const myScore = state.myRatings.get(row.id);
          const note = row.remark || row.verification_note || '특이사항 없음';
          return `
            <article class="restaurant-item">
              <div class="item-main">
                <div>
                  <div class="item-title-row">
                    <h3>${escapeHtml(row.name)}</h3>
                    <span class="status ${statusClass(row.status)}">${formatStatus(row.status)}</span>
                  </div>
                  <p class="menu">${escapeHtml(row.menu || '대표 메뉴 확인 필요')}</p>
                </div>
                <div class="link-cell">
                  <button class="save-link ${isSaved ? 'active' : ''}" type="button" data-action="save" data-id="${escapeHtml(row.id)}">
                    ${isSaved ? '저장됨' : '내 맛집 저장'}
                  </button>
                  <label class="rating-control">
                    <span>평점</span>
                    <select data-action="rate" data-id="${escapeHtml(row.id)}">
                      ${ratingOptions(myScore)}
                    </select>
                  </label>
                  <a href="${escapeHtml(links.naver)}" target="_blank" rel="noopener noreferrer">Naver</a>
                  ${links.kakao ? `<a href="${escapeHtml(links.kakao)}" target="_blank" rel="noopener noreferrer">Kakao</a>` : ''}
                  ${
                    state.user
                      ? `<button class="report-link" type="button" data-action="report-closed" data-id="${escapeHtml(row.id)}">폐업 신고</button>`
                      : reportUrl
                      ? `<a class="report-link" href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer">폐업 신고</a>`
                      : `<button class="report-link disabled" type="button" disabled>폐업 신고</button>`
                  }
                </div>
              </div>
              <dl class="item-details">
                <div>
                  <dt>영업시간</dt>
                  <dd>${escapeHtml(formatHours(row))}</dd>
                </div>
                <div>
                  <dt>비고</dt>
                  <dd>${escapeHtml(note)}</dd>
                </div>
                <div>
                  <dt>평점</dt>
                  <dd>${escapeHtml(formatRating(row))}</dd>
                </div>
                <div>
                  <dt>검증</dt>
                  <dd>${escapeHtml(row.last_verified || '검증 전')}</dd>
                </div>
              </dl>
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

function render() {
  renderSummary();
  renderList();
}

async function loadRestaurants() {
  const [response, configResponse] = await Promise.all([
    fetch('./data.json', { cache: 'no-store' }),
    fetch('./site.config.json', { cache: 'no-store' }).catch(() => null)
  ]);
  if (!response.ok) {
    throw new Error(`data.json을 불러오지 못했습니다. (${response.status})`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('data.json은 배열이어야 합니다.');
  }

  state.rows = data;
  state.config = configResponse?.ok ? await configResponse.json() : {};
  renderRegions();
  render();
}

elements.searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderList();
});

elements.regionFilter.addEventListener('change', (event) => {
  state.region = event.target.value;
  renderList();
});

for (const button of elements.statusButtons) {
  button.addEventListener('click', () => {
    state.status = button.dataset.status;
    for (const item of elements.statusButtons) {
      item.classList.toggle('active', item === button);
    }
    renderList();
  });
}

loadRestaurants().catch((error) => {
  elements.emptyState.hidden = false;
  elements.emptyState.textContent = error.message;
});

elements.loginButton.addEventListener('click', async () => {
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = '로그인 중';
  try {
    await signInWithKakao();
  } catch (error) {
    alert(error.message);
    renderAuth();
  }
});

elements.logoutButton.addEventListener('click', async () => {
  await signOutUser();
});

elements.list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const restaurant = getRestaurantById(button.dataset.id);
  if (!restaurant) return;

  try {
    if (button.dataset.action === 'save') {
      if (!state.user) {
        await signInWithKakao();
        return;
      }
      if (state.savedIds.has(restaurant.id)) {
        await unsaveRestaurant(state.user, restaurant.id);
      } else {
        await saveRestaurant(state.user, restaurant);
      }
    }

    if (button.dataset.action === 'report-closed') {
      await createClosureReport(state.user, restaurant);
      button.textContent = '신고 완료';
      button.disabled = true;
    }
  } catch (error) {
    alert(error.message);
  }
});

elements.list.addEventListener('change', async (event) => {
  const control = event.target.closest('select[data-action="rate"]');
  if (!control) return;

  const restaurant = getRestaurantById(control.dataset.id);
  if (!restaurant) return;

  try {
    if (!state.user) {
      control.value = '';
      await signInWithKakao();
      return;
    }

    const score = Number(control.value);
    if (!score) return;
    await rateRestaurant(state.user, restaurant, score);
  } catch (error) {
    alert(error.message);
  }
});

onAuthChange(async (user) => {
  state.user = user;
  renderAuth();
  await watchSavedRestaurants(user, (savedIds) => {
    state.savedIds = savedIds;
    renderList();
  });
  await watchMyRatings(user, (ratings) => {
    state.myRatings = ratings;
    renderList();
  });
});
