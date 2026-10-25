import { test, expect } from "@playwright/test";
test("한 줄 제목과 화면 너비에 따른 행 배치", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "새 할 일 추가" }).click();
  const row = page.getByTestId("task-row");
  const title = row.getByLabel("할 일 제목", { exact: true });
  await expect(title).toHaveAttribute("type", "text");
  await title.fill("한 줄 업무");
  await title.press("Enter");
  await expect(title).not.toBeFocused();
  await expect(title).toHaveValue("한 줄 업무");
  const position = async () =>
    row.evaluate((element) => {
      const box = (selector: string) =>
        element.querySelector(selector)!.getBoundingClientRect();
      return {
        title: box(".task-title").top,
        titleRight: box(".task-title").right,
        due: box(".date-control").top,
        priority: box(".priority").top,
        memo: box(".memo-toggle").left,
        checkbox: box(".task-checkbox span").right,
        handle: box(".drag-handle").right,
        margin: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--margin")),
      };
    });
  let bounds = await position();
  expect(bounds.due).toBe(bounds.title);
  expect(bounds.priority).toBe(bounds.title);
  expect(bounds.memo - bounds.titleRight).toBeLessThan(2);
  expect(bounds.checkbox).toBeLessThan(bounds.margin);
  expect(bounds.handle).toBeLessThan(bounds.checkbox);
  expect(await page.locator(".app-header").evaluate((element) => element.getBoundingClientRect().left)).toBe(0);
  await page.setViewportSize({ width: 393, height: 852 });
  bounds = await position();
  expect(bounds.due).toBe(bounds.title);
  expect(bounds.priority).toBe(bounds.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("PC에서 Enter로 새 줄을 만들고 제목 Enter는 편집을 마친다", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "PC 키보드 단축키");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "새 할 일 추가" })).toBeEnabled();
  await page.keyboard.press("Enter");
  const titles = page.getByLabel("할 일 제목", { exact: true });
  await expect(titles).toHaveCount(1);
  await expect(titles.first()).toBeFocused();
  await titles.first().fill("첫 번째 할 일");
  await titles.first().press("Enter");
  await expect(titles).toHaveCount(1);
  await expect(titles.first()).not.toBeFocused();
  await page.waitForTimeout(510);
  await page.keyboard.press("Enter");
  await expect(titles).toHaveCount(2);
  await expect(titles.last()).toBeFocused();
});
test("할 일 편집, 메모, 핀, 완료 숨김, 재접속, 삭제", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "새 할 일 추가", exact: true })
    .click();
  const title = page.getByRole("textbox", { name: "할 일 제목", exact: true });
  await expect(title).toBeFocused();
  await title.fill("산림사업 설계서 검토");
  await page.getByLabel("기한", { exact: true }).fill("2026-10-24");
  await page.getByLabel("우선순위", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "메모 추가", exact: true }).click();
  await page
    .getByLabel("진행상황 메모")
    .fill("10월 20일: 접수\n10월 21일: 현장 확인");
  await page
    .getByRole("button", { name: "산림사업 설계서 검토 더보기" })
    .click();
  await page
    .getByRole("button", {
      name: "산림사업 설계서 검토 상단 고정",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("task-row")).toHaveAttribute(
    "data-pinned",
    "true",
  );
  await page.getByLabel("산림사업 설계서 검토 완료", { exact: true }).check();
  await expect(title).toHaveCSS("text-decoration-color", "rgb(199, 96, 81)");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("완료된 할 일 표시").uncheck();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByTestId("task-row")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("완료된 할 일 표시").check();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(title).toHaveValue("산림사업 설계서 검토");
  await expect(page.getByTestId("task-row")).toHaveAttribute(
    "data-pinned",
    "true",
  );
  await expect(
    page.getByLabel("산림사업 설계서 검토 완료", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "메모", exact: true }).click();
  await expect(page.getByLabel("진행상황 메모")).toHaveValue(
    "10월 20일: 접수\n10월 21일: 현장 확인",
  );
  await page
    .getByRole("button", { name: "산림사업 설계서 검토 더보기" })
    .click();
  await page
    .getByRole("button", { name: "산림사업 설계서 검토 삭제", exact: true })
    .click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(title).toBeVisible();
  await page
    .getByRole("button", { name: "산림사업 설계서 검토 더보기" })
    .click();
  await page
    .getByRole("button", { name: "산림사업 설계서 검토 삭제", exact: true })
    .click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.getByTestId("task-row")).toHaveCount(0);
});
test("오프라인 재시작과 저장 및 모바일 넘침 방지", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("button", { name: "새 할 일 추가", exact: true })
    .click();
  await page
    .getByLabel("할 일 제목", { exact: true })
    .fill("오프라인에서도 기록하는 긴 제목 ".repeat(10));
  await page.getByRole("button", { name: "메모 추가", exact: true }).click();
  await page.getByLabel("진행상황 메모").fill("진행상황\n".repeat(20));
  await page.getByRole("button", { name: "접기", exact: true }).click();
  await expect(page.getByText("저장 중…", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByLabel("할 일 제목", { exact: true })).toHaveValue(
    "오프라인에서도 기록하는 긴 제목 ".repeat(10),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.setOffline(false);
});
test("백업 내보내기, 검증, 덮어쓰기 취소와 복원", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "새 할 일 추가", exact: true })
    .click();
  await page.getByLabel("할 일 제목", { exact: true }).fill("백업할 기록");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page
    .getByLabel("JSON 백업 파일")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":999}'),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "지원하지 않는 백업" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("할 일 제목", { exact: true }).fill("변경한 기록");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("JSON 백업 파일").setInputFiles(path!);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByLabel("할 일 제목", { exact: true })).toHaveValue(
    "변경한 기록",
  );
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("JSON 백업 파일").setInputFiles(path!);
  await page
    .getByRole("button", { name: "덮어쓰기 및 복원", exact: true })
    .click();
  await expect(
    page.getByText("백업을 복원했습니다. 할 일과 설정을 모두 불러왔습니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByLabel("할 일 제목", { exact: true })).toHaveValue(
    "백업할 기록",
  );
});
test("정렬 기준과 방향, 목록 선택 단축키, 기한 삭제", async ({ page }) => {
  await page.goto("/");
  for (const name of ["먼저", "다음", "중요"]) {
    await page
      .getByRole("button", { name: "새 할 일 추가", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "할 일 제목", exact: true })
      .last()
      .fill(name);
    await page.waitForTimeout(510);
  }
  await page
    .getByRole("button", { name: "중요 더보기" })
    .click();
  await page
    .getByRole("button", { name: "중요 상단 고정", exact: true })
    .click();
  for (const [criterion, direction] of [
    ["등록일", "최신순"],
    ["처리기한", "빠른 순"],
    ["처리기한", "늦은 순"],
    ["우선순위", "높은 순"],
    ["우선순위", "낮은 순"],
    ["등록일", "오래된 순"],
  ]) {
    await page.locator(".current-sort").click();
    await page.getByRole("dialog", { name: "할 일 정렬" }).getByRole("button", { name: criterion, exact: true }).click();
    await page.getByRole("dialog", { name: "할 일 정렬" }).getByRole("button", { name: direction, exact: true }).click();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByTestId("task-row").first()).toHaveAttribute(
      "data-pinned",
      "true",
    );
  }
  const handle = page.getByRole("button", {
    name: "다음 순서 이동",
    exact: true,
  });
  await handle.click();
  await expect(handle.locator("xpath=../..")).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByLabel("할 일 제목", { exact: true }).nth(1)).toHaveValue("다음");
  await page.keyboard.press("Space");
  await expect(page.getByLabel("다음 완료", { exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(handle.locator("xpath=../..")).toHaveAttribute("data-selected", "false");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-selected", "true");
  await page.getByTestId("task-row").nth(2).click();
  await expect(page.getByTestId("task-row").nth(2)).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("task-row").nth(1)).toHaveAttribute("data-selected", "true");
  await expect(
    page.getByRole("button", { name: "사용자 지정 정렬", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "할 일 제목", exact: true }).nth(1),
  ).toHaveValue("다음");
  await page.getByLabel("기한", { exact: true }).first().fill("2026-01-01");
  await expect(page.locator(".d-day").first()).toContainText("D+");
  await page.getByLabel("기한", { exact: true }).first().fill("");
  await expect(page.getByLabel("기한", { exact: true }).first()).toHaveValue(
    "",
  );
});
test("현지 자정 갱신 및 설치 manifest", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 21, 23, 59, 59) });
  await page.goto("/");
  await page
    .getByRole("button", { name: "새 할 일 추가", exact: true })
    .click();
  await page.getByLabel("할 일 제목", { exact: true }).fill("자정 확인");
  await page.getByLabel("기한", { exact: true }).fill("2026-10-22");
  await expect(page.locator(".d-day")).toHaveText("D-1");
  await page.clock.fastForward(2000);
  await expect(page.locator(".d-day")).toHaveText("D-Day");
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain(
    "512x512",
  );
});
test("마우스 드래그 및 320·768·1440px 화면 검증", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const headerBottom = (await page.locator(".app-header").boundingBox())!.y +
    (await page.locator(".app-header").boundingBox())!.height;
  expect((await page.locator(".task-section").boundingBox())!.y).toBe(headerBottom);
  for (const name of [
    "산림사업 설계서 검토",
    "현장 확인 일정 정리",
    "보완사항 전달",
  ]) {
    await page
      .getByRole("button", { name: "새 할 일 추가", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "할 일 제목", exact: true })
      .last()
      .fill(name);
    await page.waitForTimeout(510);
  }
  const first = await page
    .getByRole("button", {
      name: "산림사업 설계서 검토 순서 이동",
      exact: true,
    })
    .boundingBox();
  const second = await page
    .getByRole("button", { name: "현장 확인 일정 정리 순서 이동", exact: true })
    .boundingBox();
  await page.mouse.move(
    first!.x + first!.width / 2,
    first!.y + first!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    second!.x + second!.width / 2,
    second!.y + second!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(
    page.getByLabel("할 일 제목", { exact: true }).first(),
  ).toHaveValue("현장 확인 일정 정리");
  await page.waitForTimeout(100);
  await page
    .getByRole("button", { name: "산림사업 설계서 검토 더보기" })
    .click();
  await page
    .getByRole("button", {
      name: "산림사업 설계서 검토 상단 고정",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("task-row").first()).toHaveAttribute(
    "data-pinned",
    "true",
  );
  await page.getByLabel("기한", { exact: true }).first().fill("2026-10-24");
  await page
    .getByLabel("우선순위", { exact: true })
    .first()
    .selectOption("high");
  await page
    .getByRole("button", { name: "메모 추가", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("진행상황 메모")).toHaveCSS("height", "44px");
  await expect(page.getByLabel("할 일 제목", { exact: true }).first()).toHaveAttribute("spellcheck", "false");
  await page
    .getByLabel("진행상황 메모")
    .fill("10월 20일: 설계서 접수\n10월 21일: 현장 확인");
  await page.getByLabel("보완사항 전달 완료", { exact: true }).check();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize(
    testInfo.project.name === "mobile"
      ? { width: 393, height: 852 }
      : { width: 1440, height: 1000 },
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}.png`,
    fullPage: false,
  });
});
test("모바일 터치 손잡이 드래그", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "터치 프로젝트에서 실행");
  await page.goto("/");
  for (const name of ["터치 첫째", "터치 둘째"]) {
    await page
      .getByRole("button", { name: "새 할 일 추가", exact: true })
      .tap();
    await page.getByLabel("할 일 제목", { exact: true }).last().fill(name);
    await page.waitForTimeout(510);
  }
  const a = await page
      .getByRole("button", { name: "터치 첫째 순서 이동", exact: true })
      .boundingBox(),
    b = await page
      .getByRole("button", { name: "터치 둘째 순서 이동", exact: true })
      .boundingBox();
  const cdp = await context.newCDPSession(page);
  const x = a!.x + a!.width / 2,
    y = a!.y + a!.height / 2,
    end = b!.y + b!.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + ((end - y) * i) / 10 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByLabel("할 일 제목", { exact: true }).first(),
  ).toHaveValue("터치 둘째");
});
test("페이지 생성, 할 일 이동, 이름 변경과 삭제", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "새 할 일 추가" })).toBeEnabled();
  await page.getByRole("button", { name: "페이지 목록 열기" }).click();
  await page.getByRole("button", { name: "페이지 추가" }).click();
  await page.getByRole("dialog", { name: "새 페이지 만들기" }).getByLabel("페이지 이름").fill("업무");
  await page.getByRole("dialog", { name: "새 페이지 만들기" }).getByRole("button", { name: "만들기" }).click();
  await expect(page.locator(".current-page-name")).toHaveText("업무");
  await page.getByRole("button", { name: "새 할 일 추가" }).click();
  await page.getByLabel("할 일 제목").fill("회의 준비");
  await page.getByLabel("할 일 제목").blur();
  await page.getByRole("button", { name: "페이지 목록 열기" }).click();
  await page.getByRole("button", { name: "페이지 추가" }).click();
  await page.getByRole("dialog", { name: "새 페이지 만들기" }).getByLabel("페이지 이름").fill("집안일");
  await page.getByRole("dialog", { name: "새 페이지 만들기" }).getByRole("button", { name: "만들기" }).click();
  await expect(page.locator(".current-page-name")).toHaveText("집안일");
  await page.getByRole("button", { name: "새 할 일 추가" }).click();
  await page.getByLabel("할 일 제목").fill("청소하기");
  await page.getByLabel("할 일 제목").blur();
  await page.getByRole("button", { name: "페이지 목록 열기" }).click();
  await page.getByRole("button", { name: /모든 할 일/ }).click();
  await expect(page.getByLabel("할 일 제목")).toHaveCount(2);
  await expect(page.locator(".current-page-name")).toHaveText("모든 할 일");
  await expect(page.locator(".task-page-label")).toHaveCount(0);
  await page.getByRole("button", { name: "회의 준비 더보기" }).click();
  await page.getByRole("combobox", { name: "회의 준비 페이지 이동" }).selectOption({ label: "집안일" });
  await page.reload();
  await expect(page.locator(".current-page-name")).toHaveText("모든 할 일");
  await page.getByRole("button", { name: "페이지 목록 열기" }).click();
  await page.locator(".page-entry").filter({ hasText: "집안일" }).click();
  await expect(page.getByLabel("할 일 제목")).toHaveCount(2);
  await page.getByRole("button", { name: "페이지 목록 열기" }).click();
  await page.getByRole("button", { name: /모든 할 일/ }).click();
  await page.getByRole("button", { name: "페이지 목록 열기" }).click();
  await expect(page.getByRole("button", { name: "업무 이름 변경" })).toHaveCount(0);
  await page.getByRole("button", { name: "페이지 수정" }).click();
  await page.getByRole("button", { name: "업무 이름 변경" }).click();
  await page.getByRole("dialog", { name: "페이지 이름 변경" }).getByLabel("페이지 이름").fill("회사");
  await page.getByRole("dialog", { name: "페이지 이름 변경" }).getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("button", { name: "회사 삭제" })).toBeVisible();
  await page.getByRole("button", { name: "수정 완료" }).click();
  await expect(page.getByRole("button", { name: "회사 삭제" })).toHaveCount(0);
  await page.getByRole("button", { name: "페이지 수정" }).click();
  await page.getByRole("button", { name: "회사 삭제" }).click();
  await page.getByRole("dialog", { name: "페이지를 삭제하시겠습니까?" }).getByRole("button", { name: "페이지 삭제" }).click();
  await expect(page.getByRole("button", { name: "회사 삭제" })).toHaveCount(0);
  await expect(page.getByLabel("할 일 제목")).toHaveCount(2);
});
