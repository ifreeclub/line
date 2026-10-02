# 개발 기준

## 스택
- 프론트: 정적 PWA (public/index.html, app.js, styles.css, sw.js) - 빌드 도구 없음
- 백엔드: Google Apps Script 웹앱 (apps-script/Code.gs) - 리포는 사본이고 실행 주체는 라인사진관 구글 계정
- 데이터: 구글 스프레드시트 접수 탭 (앱시트와 공용)
- 호스팅: Vercel (public/ 정적 배포)

## 검증
- node --check public/app.js
- node -e "new Function(require('fs').readFileSync('apps-script/Code.gs','utf8'))"
- 로컬 확인 절차는 docs/04_LOCAL_TEST.md
- Apps Script 함수 단위 실행은 에디터에서 testList / testCreate 사용

## 배포 순서
1. Code.gs를 Apps Script 에디터에 반영 -> 배포 관리 -> 새 버전 (docs/01_APPS_SCRIPT_DEPLOY.md)
2. 프론트 푸시 -> 호스팅 자동 배포 (docs/02_VERCEL_DEPLOY.md)
- 서버를 먼저 올린다. 서버는 requestId가 없는 구버전 화면도 그대로 처리한다.
- 매장 영업 시간에는 배포하지 않는다 (영업 종료 18시).

## 건드리지 말 것
- public/config.js의 APPS_SCRIPT_URL - 배포 URL이 바뀔 때만 수정
- CONFIG.SHEET_ID / SHEET_NAME / EXCLUDE_STATUS - 매장별 운영 설정
- 접수 탭 컬럼 순서와 이름 - 앱시트가 같은 표를 사용

## 미확인
- 부하, 동시 접속, 실제 태블릿 환경 동작
