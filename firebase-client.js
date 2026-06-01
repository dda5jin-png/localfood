import { firebaseConfig, isFirebaseConfigReady, kakaoJavaScriptKey } from './firebase-config.js';

const FIREBASE_VERSION = '10.12.5';

let firebaseModules;
let app;
let auth;
let db;
let savedUnsubscribe;
let ratingsUnsubscribe;

export function firebaseReady() {
  return isFirebaseConfigReady();
}

async function loadFirebase() {
  if (firebaseModules) return firebaseModules;

  const [appModule, authModule, firestoreModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
  ]);

  firebaseModules = { appModule, authModule, firestoreModule };
  return firebaseModules;
}

export async function initFirebase() {
  if (!firebaseReady()) return null;
  if (app && auth && db) return { app, auth, db };

  const { appModule, authModule, firestoreModule } = await loadFirebase();
  app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = firestoreModule.getFirestore(app);
  return { app, auth, db };
}

function initKakao() {
  if (!window.Kakao) {
    throw new Error('Kakao JavaScript SDK가 로드되지 않았습니다.');
  }
  if (!window.Kakao.isInitialized()) {
    window.Kakao.init(kakaoJavaScriptKey);
  }
}

function kakaoLogin() {
  initKakao();
  return new Promise((resolve, reject) => {
    window.Kakao.Auth.login({
      success: resolve,
      fail: reject
    });
  });
}

export async function signInWithKakao() {
  const firebase = await initFirebase();
  if (!firebase) {
    throw new Error('Firebase/Kakao 설정이 필요합니다.');
  }

  const kakaoAuth = await kakaoLogin();
  const response = await fetch('/api/kakao-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: kakaoAuth.access_token })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`카카오 로그인 처리 실패: ${text}`);
  }

  const { customToken } = await response.json();
  const { authModule } = await loadFirebase();
  return authModule.signInWithCustomToken(firebase.auth, customToken);
}

export async function signOutUser() {
  const firebase = await initFirebase();
  if (!firebase) return;

  const { authModule } = await loadFirebase();
  await authModule.signOut(firebase.auth);
}

export async function onAuthChange(callback) {
  const firebase = await initFirebase();
  if (!firebase) {
    callback(null);
    return () => {};
  }

  const { authModule } = await loadFirebase();
  return authModule.onAuthStateChanged(firebase.auth, callback);
}

export async function watchSavedRestaurants(user, callback) {
  if (savedUnsubscribe) {
    savedUnsubscribe();
    savedUnsubscribe = null;
  }

  if (!user) {
    callback(new Set());
    return () => {};
  }

  const firebase = await initFirebase();
  const { firestoreModule } = await loadFirebase();
  const q = firestoreModule.query(
    firestoreModule.collection(firebase.db, 'user_saved_restaurants'),
    firestoreModule.where('user_id', '==', user.uid)
  );

  savedUnsubscribe = firestoreModule.onSnapshot(q, (snapshot) => {
    callback(new Set(snapshot.docs.map((doc) => doc.data().restaurant_id)));
  });
  return savedUnsubscribe;
}

export async function watchMyRatings(user, callback) {
  if (ratingsUnsubscribe) {
    ratingsUnsubscribe();
    ratingsUnsubscribe = null;
  }

  if (!user) {
    callback(new Map());
    return () => {};
  }

  const firebase = await initFirebase();
  const { firestoreModule } = await loadFirebase();
  const q = firestoreModule.query(
    firestoreModule.collection(firebase.db, 'restaurant_ratings'),
    firestoreModule.where('user_id', '==', user.uid)
  );

  ratingsUnsubscribe = firestoreModule.onSnapshot(q, (snapshot) => {
    callback(new Map(snapshot.docs.map((doc) => [doc.data().restaurant_id, doc.data().score])));
  });
  return ratingsUnsubscribe;
}

export async function saveRestaurant(user, restaurant) {
  if (!user) throw new Error('로그인이 필요합니다.');

  const firebase = await initFirebase();
  const { firestoreModule } = await loadFirebase();
  const id = `${user.uid}_${restaurant.id}`;
  await firestoreModule.setDoc(firestoreModule.doc(firebase.db, 'user_saved_restaurants', id), {
    user_id: user.uid,
    restaurant_id: restaurant.id,
    restaurant_name: restaurant.name,
    region: restaurant.region,
    menu: restaurant.menu || '',
    note: '',
    visited: false,
    saved_at: firestoreModule.serverTimestamp()
  });
}

export async function unsaveRestaurant(user, restaurantId) {
  if (!user) throw new Error('로그인이 필요합니다.');

  const firebase = await initFirebase();
  const { firestoreModule } = await loadFirebase();
  await firestoreModule.deleteDoc(firestoreModule.doc(firebase.db, 'user_saved_restaurants', `${user.uid}_${restaurantId}`));
}

export async function createClosureReport(user, restaurant) {
  if (!user) throw new Error('로그인이 필요합니다.');

  const firebase = await initFirebase();
  const { firestoreModule } = await loadFirebase();
  await firestoreModule.addDoc(firestoreModule.collection(firebase.db, 'closure_reports'), {
    user_id: user.uid,
    restaurant_id: restaurant.id,
    restaurant_name: restaurant.name,
    region: restaurant.region,
    reason: '유저 폐업 신고',
    status: 'PENDING',
    created_at: firestoreModule.serverTimestamp()
  });
}

export async function getSavedRestaurantDocs(user) {
  if (!user) return [];
  const firebase = await initFirebase();
  if (!firebase) return [];
  const { firestoreModule } = await loadFirebase();
  const q = firestoreModule.query(
    firestoreModule.collection(firebase.db, 'user_saved_restaurants'),
    firestoreModule.where('user_id', '==', user.uid)
  );
  const snapshot = await firestoreModule.getDocs(q);
  return snapshot.docs.map((doc) => doc.data());
}

export async function rateRestaurant(user, restaurant, score) {
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw new Error('평점은 1점부터 10점까지 입력할 수 있습니다.');
  }

  const firebase = await initFirebase();
  const { firestoreModule } = await loadFirebase();
  const id = `${user.uid}_${restaurant.id}`;
  await firestoreModule.setDoc(firestoreModule.doc(firebase.db, 'restaurant_ratings', id), {
    user_id: user.uid,
    restaurant_id: restaurant.id,
    restaurant_name: restaurant.name,
    region: restaurant.region,
    score,
    updated_at: firestoreModule.serverTimestamp()
  });
}
