import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createNaverSearchUrl, readData, today, writeData } from './lib/data.js';
import { parseRestaurantText } from './lib/gemini.js';

async function main() {
  const input = process.argv.slice(2).join(' ').trim();
  if (!input) {
    console.error('Usage: node add.js "방배동 la양곱창 존맛"');
    process.exit(1);
  }

  const data = await readData();
  const parsed = await parseRestaurantText(input);
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
    source_text: input,
    links: {
      naver: createNaverSearchUrl(parsed),
      kakao: ''
    },
    verification_note: ''
  };

  data.push(restaurant);
  await writeData(data);

  console.log(`Added: ${restaurant.region} / ${restaurant.name} / ${restaurant.menu}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
