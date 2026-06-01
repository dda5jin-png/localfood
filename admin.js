import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createNaverSearchUrl, normalizeRestaurantRecord, readData, today, writeData } from './lib/data.js';
import { parseRestaurantText } from './lib/gemini.js';
import { verifyRestaurant } from './lib/kakao.js';

const ADDITIONS_FILE = new URL('./pending-additions.json', import.meta.url);
const REMOVALS_FILE = new URL('./pending-removals.json', import.meta.url);

async function readJsonArray(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error(`${file.pathname} must contain a JSON array.`);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function usage() {
  console.log(`
Usage:
  node admin.js propose-add "방배동 la양곱창 존맛 근데 호불호 있음"
  node admin.js approve-add <pending_id>
  node admin.js reject-add <pending_id>
  node admin.js propose-remove <restaurant_id> "폐업 신고 접수"
  node admin.js approve-remove <pending_id>
  node admin.js reject-remove <pending_id>
  node admin.js list
`);
}

function findById(rows, id) {
  return rows.find((row) => row.id === id);
}

async function proposeAdd(text) {
  if (!text) throw new Error('Missing restaurant text.');

  const parsed = await parseRestaurantText(text);
  const verification = await verifyRestaurant(parsed);
  const pending = await readJsonArray(ADDITIONS_FILE);
  const proposedAt = today();
  const item = {
    id: randomUUID(),
    proposed_at: proposedAt,
    source_text: text,
    status: verification.exists ? 'READY_FOR_APPROVAL' : 'NEEDS_REVIEW',
    restaurant: {
      region: parsed.region,
      name: parsed.name,
      menu: parsed.menu,
      business_hours: parsed.business_hours || '확인 필요',
      holiday_note: parsed.holiday_note,
      remark: parsed.remark,
      links: {
        naver: createNaverSearchUrl(parsed),
        kakao: verification.placeUrl
      },
      verification_note: verification.note,
      last_verified: proposedAt
    }
  };

  pending.push(item);
  await writeJson(ADDITIONS_FILE, pending);
  console.log(`Pending addition created: ${item.id} (${item.status})`);
}

async function approveAdd(id) {
  const pending = await readJsonArray(ADDITIONS_FILE);
  const item = findById(pending, id);
  if (!item) throw new Error(`Pending addition not found: ${id}`);
  if (item.status !== 'READY_FOR_APPROVAL') {
    throw new Error(`Pending addition is ${item.status}. Review manually before approving.`);
  }

  const data = (await readData()).map(normalizeRestaurantRecord);
  const restaurant = {
    id: randomUUID(),
    ...item.restaurant,
    status: 'OPEN',
    source_text: item.source_text
  };

  data.push(normalizeRestaurantRecord(restaurant));
  await writeData(data);
  await writeJson(ADDITIONS_FILE, pending.filter((row) => row.id !== id));
  console.log(`Approved addition: ${restaurant.region} / ${restaurant.name}`);
}

async function rejectAdd(id) {
  const pending = await readJsonArray(ADDITIONS_FILE);
  await writeJson(ADDITIONS_FILE, pending.filter((row) => row.id !== id));
  console.log(`Rejected addition: ${id}`);
}

async function proposeRemove(restaurantId, reason) {
  if (!restaurantId) throw new Error('Missing restaurant_id.');

  const data = (await readData()).map(normalizeRestaurantRecord);
  const restaurant = findById(data, restaurantId);
  if (!restaurant) throw new Error(`Restaurant not found: ${restaurantId}`);

  const verification = await verifyRestaurant(restaurant);
  const pending = await readJsonArray(REMOVALS_FILE);
  const item = {
    id: randomUUID(),
    restaurant_id: restaurantId,
    proposed_at: today(),
    reason: reason || '관리자 제외 검토',
    status: verification.exists ? 'NEEDS_REVIEW' : 'READY_FOR_APPROVAL',
    verification_note: verification.note,
    restaurant_snapshot: restaurant
  };

  pending.push(item);
  await writeJson(REMOVALS_FILE, pending);
  console.log(`Pending removal created: ${item.id} (${item.status})`);
}

async function approveRemove(id) {
  const pending = await readJsonArray(REMOVALS_FILE);
  const item = findById(pending, id);
  if (!item) throw new Error(`Pending removal not found: ${id}`);
  if (item.status !== 'READY_FOR_APPROVAL') {
    throw new Error(`Pending removal is ${item.status}. Review manually before approving.`);
  }

  const data = (await readData()).map(normalizeRestaurantRecord);
  const restaurant = findById(data, item.restaurant_id);
  if (!restaurant) throw new Error(`Restaurant not found: ${item.restaurant_id}`);

  restaurant.status = 'EXCLUDED';
  restaurant.last_verified = today();
  restaurant.verification_note = item.reason;
  await writeData(data);
  await writeJson(REMOVALS_FILE, pending.filter((row) => row.id !== id));
  console.log(`Approved removal: ${restaurant.region} / ${restaurant.name}`);
}

async function rejectRemove(id) {
  const pending = await readJsonArray(REMOVALS_FILE);
  await writeJson(REMOVALS_FILE, pending.filter((row) => row.id !== id));
  console.log(`Rejected removal: ${id}`);
}

async function listPending() {
  const additions = await readJsonArray(ADDITIONS_FILE);
  const removals = await readJsonArray(REMOVALS_FILE);
  console.log(`Pending additions: ${additions.length}`);
  for (const item of additions) {
    console.log(`- ${item.id} [${item.status}] ${item.restaurant.region} / ${item.restaurant.name}`);
  }
  console.log(`Pending removals: ${removals.length}`);
  for (const item of removals) {
    console.log(`- ${item.id} [${item.status}] ${item.restaurant_snapshot.region} / ${item.restaurant_snapshot.name}`);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'propose-add':
      return proposeAdd(args.join(' ').trim());
    case 'approve-add':
      return approveAdd(args[0]);
    case 'reject-add':
      return rejectAdd(args[0]);
    case 'propose-remove':
      return proposeRemove(args[0], args.slice(1).join(' ').trim());
    case 'approve-remove':
      return approveRemove(args[0]);
    case 'reject-remove':
      return rejectRemove(args[0]);
    case 'list':
      return listPending();
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
