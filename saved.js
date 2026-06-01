import {
  firebaseReady,
  getSavedRestaurantDocs,
  onAuthChange,
  signInWithKakao,
  unsaveRestaurant
} from './firebase-client.js';

const el = {
  savedList: document.querySelector('#savedList'),
  savedEmpty: document.querySelector('#savedEmpty'),
  savedEmptyMsg: document.querySelector('#savedEmptyMsg'),
  loginRequired: document.querySelector('#loginRequired'),
  savedLoginBtn: document.querySelector('#savedLoginBtn'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderSavedList(docs) {
  if (docs.length === 0) {
    el.savedEmpty.hidden = false;
    el.savedList.innerHTML = '';
    return;
  }

  el.savedEmpty.hidden = true;
  el.savedList.innerHTML = `
    <div class="region-group">
      <header>
        <h2>저장한 맛집</h2>
        <span>${docs.length}곳</span>
      </header>
      <div class="region-items">
        ${docs.map((doc) => {
          const naverUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(
            [doc.region, doc.restaurant_name, doc.menu].filter(Boolean).join(' ')
          )}`;
          return `
            <article class="restaurant-item">
              <div class="item-header">
                <div class="item-title-row">
                  <h3>${escapeHtml(doc.restaurant_name)}</h3>
                  <span class="region-badge">${escapeHtml(doc.region || '')}</span>
                </div>
                <p class="menu-text">${escapeHtml(doc.menu || '')}</p>
              </div>
              <div class="item-actions">
                <button class="btn-save saved" type="button" data-id="${escapeHtml(doc.restaurant_id)}">저장 취소</button>
                <a class="btn-naver" href="${escapeHtml(naverUrl)}" target="_blank" rel="noopener noreferrer">네이버에서 확인</a>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

let currentUser = null;
let savedDocs = [];

el.savedList.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-id]');
  if (!btn || !currentUser) return;

  const restaurantId = btn.dataset.id;
  try {
    await unsaveRestaurant(currentUser, restaurantId);
    savedDocs = savedDocs.filter((d) => d.restaurant_id !== restaurantId);
    renderSavedList(savedDocs);
  } catch (err) {
    alert(err.message);
  }
});

el.savedLoginBtn?.addEventListener('click', async () => {
  try {
    await signInWithKakao();
  } catch (err) {
    alert(err.message);
  }
});

onAuthChange(async (user) => {
  currentUser = user;

  if (!firebaseReady()) {
    el.loginRequired.hidden = true;
    el.savedEmpty.hidden = false;
    el.savedEmptyMsg.textContent = 'Firebase 설정 후 이용할 수 있습니다.';
    return;
  }

  if (!user) {
    el.loginRequired.hidden = false;
    el.savedEmpty.hidden = true;
    el.savedList.innerHTML = '';
    return;
  }

  el.loginRequired.hidden = true;

  try {
    savedDocs = await getSavedRestaurantDocs(user);
    renderSavedList(savedDocs);
  } catch (err) {
    el.savedEmpty.hidden = false;
    el.savedEmptyMsg.textContent = '저장 목록을 불러오지 못했습니다.';
  }
});
