import 'dotenv/config';
import { createSign } from 'node:crypto';
import { normalizeRestaurantRecord, readData, today, writeData } from './lib/data.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const MIN_RATINGS = 30;
const MIN_AVERAGE = 7;
const ONE_POINT_EXCLUDE_COUNT = 5;

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signJwt(header, payload, privateKey) {
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64');
  return `${unsigned}.${signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

function getEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return { projectId, clientEmail, privateKey };
}

async function getAccessToken() {
  const { clientEmail, privateKey } = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: clientEmail,
      scope: FIRESTORE_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    },
    privateKey
  );

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Firebase OAuth failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

function parseFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}

function parseDocument(document) {
  const fields = document.fields || {};
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, parseFirestoreValue(value)]));
}

async function fetchAllRatings(accessToken, projectId) {
  const ratings = [];
  let pageToken = '';

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/restaurant_ratings`
    );
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Firestore ratings fetch failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    ratings.push(...(payload.documents || []).map(parseDocument));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);

  return ratings.filter((rating) => rating.restaurant_id && Number.isInteger(Number(rating.score)));
}

function aggregateRatings(ratings) {
  const groups = new Map();
  for (const rating of ratings) {
    const score = Number(rating.score);
    if (score < 1 || score > 10) continue;
    if (!groups.has(rating.restaurant_id)) groups.set(rating.restaurant_id, []);
    groups.get(rating.restaurant_id).push(score);
  }

  return groups;
}

function summarizeScores(scores) {
  const ratingCount = scores.length;
  const oneCount = scores.filter((score) => score === 1).length;
  const eligibleScores = scores.filter((score) => score !== 1);
  const average =
    eligibleScores.length > 0
      ? eligibleScores.reduce((sum, score) => sum + score, 0) / eligibleScores.length
      : 0;

  if (ratingCount >= MIN_RATINGS && oneCount >= ONE_POINT_EXCLUDE_COUNT) {
    return {
      rating_average: Number(average.toFixed(2)),
      rating_count: ratingCount,
      rating_one_count: oneCount,
      rating_status: 'EXCLUDED_ONE_POINT_QUORUM',
      excluded: true,
      note: `1점 평가 ${oneCount}명으로 제외`
    };
  }

  if (ratingCount >= MIN_RATINGS && average < MIN_AVERAGE) {
    return {
      rating_average: Number(average.toFixed(2)),
      rating_count: ratingCount,
      rating_one_count: oneCount,
      rating_status: 'EXCLUDED_LOW_AVERAGE',
      excluded: true,
      note: `평균 ${average.toFixed(1)}점으로 제외`
    };
  }

  if (ratingCount >= MIN_RATINGS) {
    return {
      rating_average: Number(average.toFixed(2)),
      rating_count: ratingCount,
      rating_one_count: oneCount,
      rating_status: 'APPROVED',
      excluded: false,
      note: `평균 ${average.toFixed(1)}점 맛집 기준 충족`
    };
  }

  return {
    rating_average: Number(average.toFixed(2)),
    rating_count: ratingCount,
    rating_one_count: oneCount,
    rating_status: 'NOT_ENOUGH_RATINGS',
    excluded: false,
    note: `평가 ${ratingCount}/${MIN_RATINGS}명`
  };
}

async function main() {
  const { projectId, clientEmail, privateKey } = getEnv();
  if (!projectId || !clientEmail || !privateKey) {
    console.log('Firebase env is missing. Skipping rating sync.');
    return;
  }

  const accessToken = await getAccessToken();
  const ratings = await fetchAllRatings(accessToken, projectId);
  const groupedRatings = aggregateRatings(ratings);
  const data = (await readData()).map(normalizeRestaurantRecord);
  const syncedAt = today();

  for (const restaurant of data) {
    const scores = groupedRatings.get(restaurant.id) || [];
    const summary = summarizeScores(scores);

    restaurant.rating_average = summary.rating_average;
    restaurant.rating_count = summary.rating_count;
    restaurant.rating_one_count = summary.rating_one_count;
    restaurant.rating_status = summary.rating_status;

    if (summary.excluded && restaurant.status !== 'CLOSED') {
      restaurant.status = 'EXCLUDED';
      restaurant.last_verified = syncedAt;
      restaurant.verification_note = summary.note;
    } else if (restaurant.status === 'EXCLUDED' && summary.rating_status === 'APPROVED') {
      restaurant.status = 'OPEN';
      restaurant.last_verified = syncedAt;
      restaurant.verification_note = summary.note;
    }
  }

  await writeData(data);
  console.log(`Rating sync complete. Ratings: ${ratings.length}, restaurants: ${data.length}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
