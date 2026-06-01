import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeRestaurantRecord } from './lib/data.js';

const DATA_FILE = new URL('./data.json', import.meta.url);
const REPORT_DIR = new URL('./reports/', import.meta.url);

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function makeTable(rows) {
  if (rows.length === 0) {
    return '_해당 항목이 없습니다._';
  }

  const lines = [
    '| 지역 | 식당명 | 대표 메뉴 | 영업시간/휴무 | 평점 | 비고 | 링크 | 마지막 검증일 |',
    '|---|---|---|---|---|---|---|---|'
  ];

  for (const row of rows) {
    const naver = row.links?.naver || '';
    const kakao = row.links?.kakao || '';
    const links = [
      naver ? `[Naver](${naver})` : '',
      kakao ? `[Kakao](${kakao})` : ''
    ].filter(Boolean).join(' / ');
    const hours = [row.business_hours || '확인 필요', row.holiday_note].filter(Boolean).join(' / ');
    const rating = row.rating_count >= 30
      ? `${Number(row.rating_average || 0).toFixed(1)}점 / ${row.rating_count}명`
      : `평가 ${row.rating_count || 0}/30명`;
    lines.push(
      `| ${escapeCell(row.region)} | ${escapeCell(row.name)} | ${escapeCell(row.menu)} | ${escapeCell(hours)} | ${escapeCell(rating)} | ${escapeCell(row.remark || row.verification_note || '')} | ${links || '-'} | ${escapeCell(row.last_verified)} |`
    );
  }

  return lines.join('\n');
}

async function readData() {
  const raw = await readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('data.json must contain a JSON array.');
  }
  return data;
}

async function main() {
  const data = (await readData()).map(normalizeRestaurantRecord);
  const openRestaurants = data
    .filter((item) => item.status === 'OPEN')
    .sort((a, b) => `${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`, 'ko'));
  const closedRestaurants = data
    .filter((item) => item.status === 'CLOSED')
    .sort((a, b) => `${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`, 'ko'));
  const excludedRestaurants = data
    .filter((item) => item.status === 'EXCLUDED')
    .sort((a, b) => `${a.region} ${a.name}`.localeCompare(`${b.region} ${b.name}`, 'ko'));

  const markdown = `# ${currentMonth()} 전국 로컬 맛집 검증 리포트

생성일: ${today()}

## 이번 달 영업 중인 맛집

${makeTable(openRestaurants)}

## 폐업으로 표시된 맛집

${makeTable(closedRestaurants)}

## 리스트에서 제외된 맛집

${makeTable(excludedRestaurants)}

---

- 전체 등록: ${data.length}곳
- 영업 중: ${openRestaurants.length}곳
- 폐업 표시: ${closedRestaurants.length}곳
- 제외: ${excludedRestaurants.length}곳
`;

  await mkdir(REPORT_DIR, { recursive: true });
  const outputFile = new URL(`./${currentMonth()}-restaurant-report.md`, REPORT_DIR);
  await writeFile(outputFile, markdown, 'utf8');

  console.log(`Report generated: reports/${currentMonth()}-restaurant-report.md`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
