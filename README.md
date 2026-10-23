# Yellow Note

노란 줄노트에 할 일을 적고, 완료하면 빨간 취소선으로 지우는 개인용 PWA입니다. PWA는 웹사이트를 홈 화면에 설치하고 오프라인에서도 쓸 수 있게 만든 앱입니다. 로그인과 서버 없이 동작합니다.

## 1. 내 컴퓨터에서 실행하기

1. Node.js 22.12 이상 LTS를 설치합니다. Node.js는 이 앱을 실행·빌드하는 도구입니다.
2. 터미널에서 이 프로젝트 폴더로 이동합니다.
3. 아래 명령을 차례로 실행합니다.

```bash
cd /Users/gwangho/dev/yellownote
npm install
npm run dev
```

4. 터미널에 표시되는 주소(기본 `http://127.0.0.1:5173/`)를 브라우저에서 엽니다.
5. 종료하려면 터미널에서 `Ctrl+C`를 누릅니다.

다른 컴퓨터에서는 `cd` 뒤의 폴더 경로를 실제 프로젝트 위치로 바꾸세요. 개발 모드에서는 서비스 워커가 켜지지 않습니다. 오프라인 사용을 확인하려면 다음 명령으로 완성된 빌드를 실행하세요.

```bash
npm run build
npm run preview
```

표시된 주소(기본 `http://127.0.0.1:4173/`)를 온라인 상태에서 한 번 열고 ‘오프라인 사용 준비 완료’를 확인하세요. 로컬 실행 주소는 이 컴퓨터에서만 접근됩니다. 휴대폰에서는 GitHub Pages로 배포한 HTTPS 주소를 사용하세요.

## 2. 기본 사용법

- 하단 **+**: 새 줄을 만들고 바로 제목 입력을 시작합니다. 0.5초 내 연속 누르기를 막으며, 제목이 빈 미완료 줄이 이미 있으면 그 줄로 이동합니다. 빈 제목도 초안으로 보관되며 휴지통으로 삭제할 수 있습니다.
- 제목: 새 할 일은 바로 입력할 수 있고, 기존 할 일은 먼저 줄을 선택한 뒤 제목을 다시 눌러 수정합니다. Enter를 누르면 입력이 완료됩니다.
- 날짜: 처리기한 영역을 눌러 날짜를 지정하거나 선택 도구에서 지웁니다. D-3은 3일 남음, D-Day는 오늘, D+2는 2일 지남입니다.
- 우선순위: 상(빨강), 중(주황), 하(초록), 미설정 중 선택합니다.
- 핀: 우선순위와 독립적으로 목록 상단에 고정합니다. 완료해도 핀은 유지됩니다.
- 메모: ‘메모 추가’ 또는 ‘메모’를 눌러 펼칩니다. 여러 줄 작성·수정·복사가 가능합니다.
- 체크박스: 완료하면 회색 글씨와 빨간 취소선이 표시됩니다. 해제하면 기존 기한·메모·우선순위·핀을 유지한 채 복원됩니다.
- 휴지통: 확인창에서 **삭제**를 선택한 경우에만 메모와 함께 삭제됩니다.
- 정렬: 등록일·처리기한·우선순위 중 기준을 고른 뒤 해당 기준의 순서를 선택합니다. 기한/우선순위 미설정 항목은 해당 정렬에서 항상 뒤에 놓입니다.
- 목록 선택: 줄이나 왼쪽 점 손잡이를 클릭하면 테두리로 활성화됩니다. 위·아래 방향키는 선택을 이동하고, Shift+방향키는 같은 그룹 안에서 순서를 바꿉니다. Space는 완료를 전환하고 Escape는 선택을 해제합니다. 선택이 없을 때 방향키를 누르면 첫 할 일이 활성화됩니다.
- 왼쪽 점 손잡이: 마우스/터치로 드래그해서 순서를 바꿀 수 있습니다. 고정 그룹과 일반 그룹 사이로는 이동하지 않습니다.
- 다른 정렬에서 드래그해도 현재 표시 순서를 기준으로 사용자 지정 정렬로 전환됩니다.
- 설정 → 완료된 할 일 표시: 숨겨도 데이터는 지워지지 않습니다. 완료된 지 오래되어도 자동 삭제하지 않습니다.

## 3. 데이터 저장과 백업

**IndexedDB**는 브라우저 안에 있는 데이터베이스입니다. `yellow-note` 데이터베이스의 `tasks`에는 할 일, `settings`에는 완료 표시 여부와 정렬 설정을 보관합니다. Dexie.js를 통해 접근합니다.

- UUID v4 고유 ID를 `crypto.randomUUID()`로 만듭니다.
- 기한은 현지 달력의 `YYYY-MM-DD` 문자열로 저장해 UTC 변환에 따른 날짜 이동을 피합니다.
- 생성·수정·완료 시각은 ISO 8601 UTC 문자열입니다.
- 제목·메모는 약 180ms 동안 입력을 모아 저장하고, 포커스 해제 시 즉시 저장합니다. 체크·핀 등의 변경은 바로 저장합니다.
- 저장 전 변경사항은 localStorage에 임시 복구 기록으로 남기고, IndexedDB 저장이 끝나면 제거합니다. 다음 시작 시 미완료 저장을 복구합니다. localStorage는 주 저장소가 아닌 짧은 복구용 기록입니다.
- 저장 중 종료 시 경고를 요청하며, 저장 오류는 화면에 표시합니다. ‘다시 저장’으로 재시도하거나 설정에서 현재 화면의 내용을 백업할 수 있습니다.
- 스키마는 버전 1입니다. 향후 변경은 `src/data/db.ts`에 다음 버전과 `upgrade()` 마이그레이션을 추가하세요. 기존 버전을 덮어쓰지 마세요.

**내보내기:** 설정 → 내보내기 → `yellow-note-backup-YYYY-MM-DD.json` 다운로드. 모든 할 일과 설정, UUID·메모·줄바꿈·핀·완료·정렬 정보가 포함됩니다.

**가져오기:** 설정 → 가져오기 → JSON 선택 → 검증 결과 확인 → ‘덮어쓰기 및 복원’. 현재 기록 전체가 백업으로 교체됩니다. 먼저 현재 내용을 내보내세요. 지원 버전, 필드 유형, 실제 달력 날짜, UUID 중복, 완료 시각 등을 검증하며 잘못된 파일은 거절합니다. 교체는 한 트랜잭션(전체 성공 또는 전체 취소)으로 처리합니다. 50MB 이하의 백업을 지원합니다.

브라우저 데이터 삭제, 저장 공간 정리, 기기 분실에 대비해 JSON을 주기적으로 보관하세요. 휴대폰과 PC는 각각 다른 저장소입니다. 자동 동기화하지 않으며 JSON으로 이동할 수 있습니다. 같은 브라우저·같은 웹 주소에서도 여러 탭을 동시에 편집하는 작업은 지원하지 않습니다. 한 탭에서 사용하세요.

## 4. GitHub Pages 배포 — 처음 하는 경우

GitHub Pages는 HTML·CSS·JavaScript 정적 파일을 인터넷에 공개해 주는 서비스입니다. 노트 내용은 GitHub에 올라가지 않고 각 사용자의 브라우저에 저장됩니다.

**현재 공개 주소: [Yellow Note 열기](https://hgh-dev.github.io/yellownote/)**. `hgh-dev/yellownote` 저장소의 `main`에 올리면 GitHub Actions가 자동으로 다시 배포합니다. 아래 단계는 다른 저장소에 처음 설치할 때 참고하세요.

로컬 미리보기(`127.0.0.1:5173`)에 적어 둔 기록은 공개 주소에 자동으로 옮겨지지 않습니다. 로컬 미리보기에서 **설정 → 내보내기**로 JSON을 받은 다음, 공개 주소에서 **설정 → 가져오기**로 복원하세요. 주소마다 브라우저 저장소가 따로 있습니다.

1. GitHub에 로그인하고 **New repository**를 눌러 `yellownote` 저장소를 만드세요. 무료 개인 계정에서는 공개(Public) 저장소를 사용하면 편리합니다.
2. GitHub Desktop에서 **Add Local Repository**를 선택합니다. 이 폴더가 Git 저장소가 아니라고 나오면 **create a repository here**로 이 프로젝트 폴더에 저장소를 만드세요. 또는 터미널에서 다음을 실행합니다.

```bash
git init -b main
git add .
git commit -m "Build Yellow Note PWA"
git remote add origin https://github.com/YOUR_NAME/yellownote.git
git push -u origin main
```

`YOUR_NAME`은 본인 GitHub 사용자명으로 바꾸세요. 로그인 인증이 필요할 수 있습니다. `node_modules`와 `dist`는 `.gitignore`로 제외됩니다. **`.github/workflows/deploy.yml`과 `package-lock.json`도 반드시 포함하세요.** GitHub Desktop에서는 변경사항 Commit 후 Publish/Push를 누르면 됩니다.

3. GitHub 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
4. **Actions → Deploy Yellow Note to GitHub Pages → Run workflow**를 누릅니다. 이후 `main` 브랜치에 변경사항을 올리면 자동 배포됩니다.
5. Actions의 `build`, `deploy`가 초록색 체크가 될 때까지 기다립니다.
6. **Settings → Pages**의 공개 주소를 엽니다. 일반적으로 `https://YOUR_NAME.github.io/yellownote/`입니다.

워크플로는 의존성 설치 → 단위 테스트 → TypeScript 검사와 빌드 → Pages 배포를 수행합니다. GitHub의 Pages 설정에서 base path를 읽어 Vite 자산, Manifest, 서비스 워커 경로에 반영합니다. 저장소 이름이 달라져도 워크플로 파일의 수정은 필요하지 않습니다. `YOUR_NAME.github.io` 루트 저장소도 지원합니다.

수동으로 하위 경로 빌드를 확인하려면:

```bash
VITE_BASE_PATH=/yellownote/ npm run build
npm run preview
```

이때 `http://127.0.0.1:4173/yellownote/`로 접속하세요. Windows PowerShell에서는 `$env:VITE_BASE_PATH="/yellownote/"`를 먼저 실행하세요. 개발 빌드로 돌아가려면 해당 환경변수를 해제합니다.

화면이 안 뜨면 Pages Source, Actions 실패 로그, 주소 끝의 저장소 경로를 확인하세요. 이 앱은 별도 하위 화면 URL을 사용하지 않아 기본 주소 새로고침 시 라우팅 오류가 없습니다. 공개 웹 주소가 바뀌면 이전 주소의 브라우저 데이터는 자동 이동하지 않으므로 먼저 백업하세요.

## 5. 홈 화면에 설치와 업데이트

- Android Chrome: 설정의 설치 버튼 또는 브라우저 메뉴 → 앱 설치/홈 화면에 추가.
- iPhone/iPad Safari: 공유 → 홈 화면에 추가.
- PC Chrome/Edge: 주소창의 설치 아이콘 또는 브라우저 메뉴의 앱 설치.
- 오프라인 사용: 최초 온라인 방문 및 서비스 워커 준비가 필요합니다. 정적 파일만 캐시하며 외부 폰트·서버·CDN에 의존하지 않습니다.
- 업데이트: 새 서비스 워커가 대기하면 ‘저장 후 업데이트’를 표시합니다. 버튼을 누르면 변경사항을 먼저 저장한 후 새 버전을 적용합니다. 저장 실패 시 업데이트를 보류합니다. 앱을 사용하는 중 자동으로 페이지를 새로고침하지 않습니다.

## 6. 주요 파일

```text
src/
  App.tsx                 전체 화면과 드래그·설치·업데이트 연결
  components/
    TaskRow.tsx           인라인 제목, 기한, 메모, 핀, 완료
    Dialog.tsx            키보드 포커스를 관리하는 확인창
    SortDialog.tsx        정렬 선택
    SettingsDialog.tsx    설정, JSON 백업/복원, 설치 안내
  data/
    db.ts                 Dexie 스키마와 복원 트랜잭션
    store.ts              자동 저장, 임시 복구, 오류·재시도
  hooks/useToday.ts       현지 자정·앱 복귀 시 날짜 갱신
  lib/tasks.ts            날짜 계산, 정렬, 그룹 내 순서 변경
  lib/backup.ts           JSON 형식과 데이터 무결성 검증
  types.ts                할 일·설정·백업 데이터 형식
  styles.css              줄노트 배경, 반응형 화면, 빨간 취소선
public/                   SVG 원본과 180/192/512px PNG 앱 아이콘
vite.config.ts            PWA와 배포 경로
.github/workflows/         GitHub Pages 자동 배포
tests/                    규칙·저장 테스트와 브라우저 테스트
```

## 7. 테스트 실행

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

이미 Chrome이 설치되어 있다면 브라우저 다운로드 없이 `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`를 사용할 수 있습니다. 브라우저 테스트는 `dist` 빌드를 사용하므로 코드 변경 후 반드시 다시 빌드하세요.

- 단위 테스트: 날짜/D-day/윤년, 핀 우선, 정렬 방향과 미설정 값, 완료 보존, 그룹 간 드래그 제한, 백업 검증, IndexedDB 저장·재접속·복원 원자성, 연속 입력, 저장 실패 재시도.
- 브라우저 테스트: 데스크톱·모바일 크기에서 CRUD, 메모, 빨간 취소선, 고정·완료 숨김, 재접속, 백업/복원, 오프라인 재시작·저장, 모든 정렬, 키보드·마우스 드래그, 자정 갱신, Manifest, 320/768/1440px 넘침 확인.
- 실기기 iOS/Android 설치, 소프트 키보드와 실제 터치 제스처, OS 저장 공간 회수, 서비스 워커의 실제 새 버전 전환은 자동 테스트만으로 보장하지 않습니다. 배포 후 본인의 기기에서도 확인하세요.

실제 테스트 결과와 배포 검증 범위는 `docs/TESTING.md`에 기록합니다.

## 참고한 공식 문서

- [Vite PWA React 통합](https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/frameworks/react.md)
- [dnd-kit Sortable](https://dndkit.com/legacy/presets/sortable/overview/)
