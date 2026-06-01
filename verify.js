import 'dotenv/config';
import { createNaverSearchUrl, normalizeRestaurantRecord, readData, today, writeData } from './lib/data.js';
import { sleep, verifyRestaurant } from './lib/kakao.js';

async function main() {
  const data = (await readData()).map(normalizeRestaurantRecord);
  const verifiedAt = today();
  let closedCount = 0;
  let checkedCount = 0;

  for (const restaurant of data) {
    if (restaurant.status !== 'OPEN') continue;

    checkedCount += 1;
    const verification = await verifyRestaurant(restaurant);

    restaurant.last_verified = verifiedAt;
    restaurant.links = {
      naver: createNaverSearchUrl(restaurant),
      kakao: verification.placeUrl || restaurant.links?.kakao || ''
    };

    if (!verification.exists) {
      restaurant.status = 'CLOSED';
      restaurant.verification_note = verification.note;
      closedCount += 1;
      console.log(`CLOSED: ${restaurant.region} / ${restaurant.name}`);
    } else {
      restaurant.status = 'OPEN';
      restaurant.verification_note = verification.note;
      console.log(`OPEN: ${restaurant.region} / ${restaurant.name}`);
    }

    await sleep(250);
  }

  await writeData(data);
  console.log(`Verification complete. Checked ${checkedCount}, newly closed ${closedCount}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
