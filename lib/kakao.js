const KAKAO_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchKakao(restaurant) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    throw new Error('Missing KAKAO_REST_API_KEY. Set it in .env or GitHub Actions secrets.');
  }

  const query = `${restaurant.region} ${restaurant.name}`.trim();
  const url = new URL(KAKAO_SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('category_group_code', 'FD6');
  url.searchParams.set('size', '5');

  const response = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kakao API failed (${response.status}) for "${query}": ${errorText}`);
  }

  const payload = await response.json();
  return payload.documents || [];
}

export function isLikelySameRestaurant(restaurant, kakaoPlace) {
  const storedName = restaurant.name.toLowerCase().replace(/\s+/g, '');
  const kakaoName = String(kakaoPlace.place_name || '').toLowerCase().replace(/\s+/g, '');
  return kakaoName.includes(storedName) || storedName.includes(kakaoName);
}

export function bestPlaceFor(restaurant, results) {
  return results.find((place) => isLikelySameRestaurant(restaurant, place)) || results[0] || null;
}

export async function verifyRestaurant(restaurant) {
  const results = await searchKakao(restaurant);
  const place = bestPlaceFor(restaurant, results);
  const exists = results.length > 0;

  return {
    exists,
    place,
    placeUrl: place?.place_url || '',
    note: exists
      ? isLikelySameRestaurant(restaurant, place)
        ? '카카오 로컬에서 동일 상호 확인'
        : '카카오 로컬 검색 결과 있음, 상호 확인 필요'
      : '카카오 로컬 검색 결과 없음'
  };
}
