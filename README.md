# 전국 로컬 맛집 리스트

Zero-cost 운영을 전제로 만든 정적 맛집 리스트입니다.

## 역할

- 일반 유저: 웹페이지에서 맛집을 보고, 폐업이 의심되면 `폐업 신고`로 GitHub Issue를 생성합니다.
- 관리자: GitHub 저장소 권한을 가진 사람만 `data.json`, `pending-additions.json`, `pending-removals.json`을 변경하고 승인 커밋을 반영합니다.
- 월간 에이전트: GitHub Actions가 매월 1일 00:00 KST에 Kakao Local API로 영업 여부를 검증하고 리포트를 생성합니다.

## Firebase 앱 기능

Firebase 설정을 채우면 카카오 로그인, 내 맛집 저장, 로그인 유저의 폐업 신고가 활성화됩니다.

1. Firebase Web App 설정을 [firebase-config.js](./firebase-config.js)에 입력합니다.
2. Kakao JavaScript Key를 [firebase-config.js](./firebase-config.js)에 입력합니다.
3. Vercel 환경변수에 Firebase 서비스 계정 값을 추가합니다.

```bash
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

카카오 로그인은 브라우저에서 Kakao access token을 받은 뒤, Vercel Function `api/kakao-login.js`가 Kakao 사용자 정보를 확인하고 Firebase custom token을 발급하는 흐름입니다.

Firestore Rules 초안은 [firestore.rules](./firestore.rules)에 있습니다.

## 맛집 평점 기준

유저는 로그인 후 각 맛집에 1점부터 10점까지 점수를 줄 수 있습니다.

- 평가가 30명 미만이면 `평가 대기` 상태입니다.
- 평가가 30명 이상이고, 1점 평가가 5명 이상이면 평균과 관계없이 `EXCLUDED` 처리합니다.
- 평가가 30명 이상이고, 1점을 제외한 평균이 7점 미만이면 `EXCLUDED` 처리합니다.
- 평가가 30명 이상이고, 1점을 제외한 평균이 7점 이상이면 맛집 기준을 충족한 것으로 봅니다.

월간 GitHub Actions는 `npm run sync-ratings`로 Firestore의 `restaurant_ratings`를 읽고 이 기준을 `data.json`에 반영합니다.

## 유저 폐업 신고 연결

`site.config.json`의 `githubIssuesUrl`을 실제 저장소 Issue 생성 URL로 바꾸면 됩니다.

```json
{
  "githubIssuesUrl": "https://github.com/OWNER/REPO/issues/new"
}
```

브라우저에서 직접 `data.json`을 수정하지 않기 때문에 API 키와 관리자 권한이 노출되지 않습니다.

## 관리자 승인 명령

신규 맛집은 사전 검증 후 대기열에 들어갑니다.

```bash
npm run admin -- propose-add "방배동 la양곱창 존맛 근데 호불호 있음"
npm run admin -- list
npm run admin -- approve-add <pending_id>
npm run admin -- reject-add <pending_id>
```

리스트 제외도 사전 검증 후 대기열에 들어갑니다.

```bash
npm run admin -- propose-remove <restaurant_id> "폐업 신고 확인"
npm run admin -- list
npm run admin -- approve-remove <pending_id>
npm run admin -- reject-remove <pending_id>
```

`approve-remove`는 식당을 삭제하지 않고 `EXCLUDED` 상태로 바꿉니다. 기록을 남겨야 나중에 왜 빠졌는지 추적할 수 있습니다.

## 월간 검증

```bash
npm run verify
npm run report
```

GitHub Actions에서는 `.github/workflows/cron.yml`이 같은 작업을 자동으로 실행하고 변경분을 커밋합니다.
