import { readFile, writeFile } from 'node:fs/promises';

export const DATA_FILE = new URL('../data.json', import.meta.url);

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function readData() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error('data.json must contain a JSON array.');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeData(data) {
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function createNaverSearchUrl(restaurant) {
  const query = [restaurant.region, restaurant.name, restaurant.menu].filter(Boolean).join(' ');
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
}

export function normalizeRestaurantRecord(record) {
  return {
    ...record,
    status: record.status || 'OPEN',
    rating_average: Number(record.rating_average || 0),
    rating_count: Number(record.rating_count || 0),
    rating_one_count: Number(record.rating_one_count || 0),
    rating_status: record.rating_status || 'NOT_ENOUGH_RATINGS',
    business_hours: record.business_hours || '확인 필요',
    holiday_note: record.holiday_note || '',
    remark: record.remark || '',
    source_text: record.source_text || '',
    links: {
      naver: record.links?.naver || createNaverSearchUrl(record),
      kakao: record.links?.kakao || ''
    },
    verification_note: record.verification_note || ''
  };
}
