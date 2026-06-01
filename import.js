import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createNaverSearchUrl, readData, today, writeData } from './lib/data.js';
import { parseRestaurantText } from './lib/gemini.js';

const inputFile = process.argv[2] || 'raw-list.txt';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDuplicate(data, item) {
  const target = `${item.region} ${item.name}`.replace(/\s+/g, '').toLowerCase();
  return data.some((row) => `${row.region} ${row.name}`.replace(/\s+/g, '').toLowerCase() === target);
}

async function main() {
  const raw = await readFile(inputFile, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (lines.length === 0) {
    throw new Error(`${inputFile} has no restaurant lines.`);
  }

  const data = await readData();
  let added = 0;
  let skipped = 0;

  for (const line of lines) {
    const parsed = await parseRestaurantText(line);
    const restaurant = {
      id: randomUUID(),
      region: parsed.region,
      name: parsed.name,
      menu: parsed.menu,
      business_hours: parsed.business_hours || '확인 필요',
      holiday_note: parsed.holiday_note,
      status: 'OPEN',
      last_verified: today(),
      remark: parsed.remark,
      source_text: line,
      links: {
        naver: createNaverSearchUrl(parsed),
        kakao: ''
      },
      verification_note: ''
    };

    if (isDuplicate(data, restaurant)) {
      skipped += 1;
      console.log(`SKIP duplicate: ${restaurant.region} / ${restaurant.name}`);
    } else {
      data.push(restaurant);
      added += 1;
      console.log(`ADD: ${restaurant.region} / ${restaurant.name} / ${restaurant.menu}`);
    }

    await sleep(500);
  }

  await writeData(data);
  console.log(`Import complete. Added ${added}, skipped ${skipped}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
