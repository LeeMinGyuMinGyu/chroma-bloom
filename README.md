# Chroma Bloom — 실행 & 개발 가이드

물감으로 칠한 색이 **간접광(GI)으로 번져** 길을 여는 1인칭 퍼즐. 그래픽스 기말 과제용 골격.

---

## 1. 지금 상태 (솔직하게)

- **게임 레이어 = 동작함(목표).** 방1: 이동 + 시점 + 칠하기 + 빨강→빛의 다리 + 클리어.
  표준 Three.js 라이팅만 쓰므로 **WebGPU가 없어도 WebGL2로 폴백되어 실행**된다. → 오늘 23:59 링크는 이걸로 확보.
- **DDGI 레이어 = 골격(미완성).** `src/gi/ddgi.js`는 프로브 그리드/갱신/샘플링의 *구조와 알고리즘 주석, 레퍼런스*만 있고
  실제 컴퓨트 패스는 TODO다. GI 점수(20)를 위해 **채점 전 새벽까지 브라우저에서** 채워 넣어야 한다.
- ⚠ 이 골격은 **브라우저/GPU에서 검증되지 않았다.** 반드시 최신 Chrome에서 직접 실행하며 디버깅하라.
- 방의 빨강 "바운스 빛"은 **PLACEHOLDER**(임시)다 — 진짜 DDGI 간접광으로 교체 대상. (`src/room1.js`에 표시)

## 2. 파일 구조

```
chroma-bloom/
├─ index.html        # 진입점 + importmap(CDN) + 로딩/HUD/클리어 UI
├─ package.json      # (선택) 로컬 서버용
└─ src/
   ├─ main.js        # 렌더러 init, 씬/카메라/라이팅, 시스템 조립, 루프
   ├─ player.js      # 1인칭 컨트롤러(포인터 락 + WASD + 경계/틈 차단)
   ├─ paint.js       # 색 선택(1/2/3) + 좌클릭 칠하기(레이캐스트)
   ├─ room1.js       # 방1 지오메트리 + 빛의 다리 + 클리어 판정
   └─ gi/
      └─ ddgi.js     # DDGI 레이어 골격 (TODO + 레퍼런스)
```

## 3. 로컬 실행

ES 모듈 + importmap이라 **반드시 로컬 서버**로 열어야 한다(파일 더블클릭 ✗).

```bash
cd chroma-bloom
npx --yes serve .        # 또는: python3 -m http.server 8080
```

브라우저에서 표시된 주소(예: http://localhost:3000) 접속 → "시작하기" 클릭(포인터 락).

## 4. 배포 (GitHub Pages) — 0점 방지의 1번

```bash
git init && git add . && git commit -m "chroma bloom mvp"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

GitHub → 저장소 **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: main / (root) → Save.** 1~2분 뒤 `https://<USER>.github.io/<REPO>/` 가 열린다.

- [ ] **오늘 23:59 전, 위 링크가 최신 Chrome에서 실제로 열리는지 확인**하고 KLAS에 제출.
- [ ] 이후 보정은 **같은 저장소에 커밋**(같은 URL 유지). 항상 "도는 상태"로 커밋할 것.
- [ ] 리포트 MD도 같은 저장소에서 열리는 링크로(예: `report.md` 또는 `README.md`).

## 5. DDGI 완성 로드맵 (GI 20점)

`src/gi/ddgi.js` 상단 주석의 단계대로. 권장 순서(디버깅 쉬움):

1. `_addDebugProbes()` 켜서 **프로브 그리드가 방에 맞게 깔리는지 눈으로 확인** (리포트 캡쳐로도 좋음).
2. 프로브 irradiance 저장용 텍스처/버퍼 생성.
3. 갱신 패스 구현 — 작은 방이므로 **박스 SDF 레이마칭(대안 A)** 이 큐브 캡처보다 단순.
4. 머티리얼에 간접광 노드 주입(8프로브 trilinear). 칠한 색이 옆 면으로 번지면 성공.
5. 시간 누적 + `markDirty()` 시 빠른 재수렴.

레퍼런스: morgan3d DDGI 글, NVIDIA RTXGI-DDGI, helenl9098의 Vulkan 구현 (파일 주석에 링크).

> 시간이 부족하면: **GI는 점수의 20%**다. "링크가 매끄럽게 열림(게이팅) + 리포트(40) + 본인 캡쳐"를 먼저 확보하고,
> 남는 시간에 GI를 끌어올려라. PLACEHOLDER 바운스만 남는다면 리포트엔 *구현한 그대로* 정직하게 쓰고
> DDGI는 "향후 과제"로 기술하라(허위 기재 금지).

## 6. 다음 방(확장) 메모

- 방2: 빨강(다리) + 파랑(장애물 제거). `room1.js`를 복제해 paintable/로직 추가.
- 방3: 노랑(숨은 경로) + 원격 칠하기 + 다중 색. 방 전환 시 **안 보이는 방은 렌더 끄기**(부하↓).
