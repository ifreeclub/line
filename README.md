# 라인사진관 손님용 태블릿 웹

기존 AppSheet 관리자 앱과 구글시트를 공유하는 손님용 접수 웹앱

---

## 아키텍처

```
[갤럭시탭 A9]
      |
      | HTTPS (fetch POST, text/plain)
      v
[Vercel - 정적 호스팅]   <---- HTML/CSS/JS/PWA
      |
      | API 호출
      v
[Google Apps Script Web App]   <---- doPost JSON API
      |
      | SpreadsheetApp
      v
[Google Sheets - 라인리스 / 라인_앱접수 탭]
      ^
      |
[AppSheet 관리자 앱 - 미담_테접수]   <---- 기존 그대로 유지
```

---

## 기술 스택 근거

| 선택 | 이유 |
|------|------|
| Apps Script 백엔드 | 구글시트와 네이티브 통합 / CORS 회피 / 무료 / 일일 20,000 UrlFetch 할당량으로 사진관 규모 충분 |
| Vercel 정적 호스팅 | PWA 지원 / HTTPS 자동 / 깃허브 연동 자동 배포 / 커스텀 도메인 무료 |
| text/plain POST | CORS preflight 회피 (Apps Script는 OPTIONS 미지원) |
| 8자리 영숫자 ID | AppSheet UNIQUEID() 형식과 호환 |

---

## 폴더 구조

```
midam-tablet/
├── apps-script/
│   └── Code.gs              # 백엔드 (복사해서 Apps Script에 붙여넣기)
├── public/                  # Vercel 배포 루트
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── config.js            # <-- 2호점 복사 시 여기만 수정
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── docs/
│   ├── 01_APPS_SCRIPT_DEPLOY.md    # 백엔드 배포 가이드
│   ├── 02_VERCEL_DEPLOY.md         # 프론트 배포 가이드
│   ├── 03_NEW_BRANCH_COPY.md       # 2호점 복사 가이드
│   └── make_icons.py               # 아이콘 재생성
├── vercel.json
├── package.json
└── .gitignore
```

---

## 빠른 시작 (1호점 최초 배포)

```
1. docs/01_APPS_SCRIPT_DEPLOY.md  -> Apps Script 배포
2. docs/02_VERCEL_DEPLOY.md       -> Vercel 배포
3. 갤럭시탭 홈 화면 추가 + 앱 고정
```

## 2호점 복사

```
docs/03_NEW_BRANCH_COPY.md 참조 (약 20분 소요)
```

---

## 주요 기능

### 접수 등록 (좌측)
- 이름 (필수) / 전화번호 (필수 4자리 이상) / 이메일 (선택)
- 등록 시 구글시트 `미담_앱접수` 탭에 새 행 추가
- 8자리 영숫자 ID 자동 생성 (AppSheet UNIQUEID와 동일 형식)

### 대기리스트 (우측)
- 상황이 `완료`/`취소`가 아닌 건만 표시
- 이름만 노출 (전화번호/이메일 비노출)
- 30초마다 자동 새로고침 + 수동 새로고침 버튼
- 최신 등록이 상단

### 정보 수정 플로우
1. 대기리스트에서 이름 클릭
2. 끝4자리 입력 모달
3. 서버에서 전화번호 끝4자리와 비교 인증
4. 성공 시 수정 모달 오픈 (이름 읽기전용, 전화번호/이메일 수정 가능)
5. 저장 시 서버에서 재인증 후 업데이트

---

## 보안

- 입력값 sanitize (제어 문자 제거 + 길이 제한)
- XSS 방어: 모든 DOM 삽입은 `textContent` 사용, `innerHTML` 금지
- API 토큰 방식 간이 인증 (config.js와 Apps Script CONFIG에서 일치 필요)
- 전화번호 끝4자리 인증 (수정 요청마다 재검증)
- HTTPS 강제 (Vercel 기본 / Apps Script 기본)
- LockService로 동시 쓰기 race condition 방지
- Permissions-Policy 헤더로 카메라/마이크/위치 차단
- 서비스 워커는 Apps Script 요청 캐시 금지 (항상 최신 데이터)

---

## 코드 품질

- 에러 처리: 모든 API 호출에 try/catch + 사용자 친화 메시지 변환
- 타임아웃: 15초 AbortController
- 동시 요청 방지: isSubmitting / isLoading 플래그
- ESC 키로 모달 닫기
- 디버그 모드: `DEBUG_BORDER` 토글로 레이아웃 border 표시/숨김

---

## 관리자 앱 (AppSheet)

별도 유지 - 수정 불필요

- 앱 이름: `미담_테접수`
- 동일 구글시트(`미담_앱접수`)에서 읽기/쓰기
- 웹에서 등록한 건은 AppSheet에서 실시간 확인 가능
- 상황을 `완료` 또는 `취소`로 변경하면 웹 대기리스트에서 자동 제외

---

## 라이선스

비공개 - YSajang / 미담사진관
