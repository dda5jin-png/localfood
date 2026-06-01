import { createSign } from 'node:crypto';

const TOKEN_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

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

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function fetchKakaoUser(accessToken) {
  const response = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
    }
  });

  if (!response.ok) {
    throw new Error(`Kakao user lookup failed (${response.status})`);
  }

  return response.json();
}

function createFirebaseCustomToken(kakaoUser) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error('Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY.');
  }

  const now = Math.floor(Date.now() / 1000);
  const uid = `kakao:${kakaoUser.id}`;
  const nickname = kakaoUser.kakao_account?.profile?.nickname || '';

  return signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: clientEmail,
      sub: clientEmail,
      aud: TOKEN_AUDIENCE,
      iat: now,
      exp: now + 3600,
      uid,
      claims: {
        provider: 'kakao',
        kakao_id: String(kakaoUser.id),
        nickname
      }
    },
    privateKey
  );
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    json(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { accessToken } = await readBody(request);
    if (!accessToken) {
      json(response, 400, { error: 'Missing accessToken' });
      return;
    }

    const kakaoUser = await fetchKakaoUser(accessToken);
    const customToken = createFirebaseCustomToken(kakaoUser);
    json(response, 200, {
      customToken,
      profile: {
        kakaoId: String(kakaoUser.id),
        nickname: kakaoUser.kakao_account?.profile?.nickname || ''
      }
    });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
}
