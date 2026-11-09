import { expect, test } from "@playwright/test";
import { uploadFixture } from "./helpers.js";

test("upload a fixture and land on graphs", async ({ page }) => {
  await uploadFixture(page);
  await expect(page.locator("nav")).toContainText("2 projects · 20 commits");
  await page.getByRole("button", { name: "Go to graphs" }).click();
  await expect(page).toHaveURL(/#\/graphs/);
  await expect(page.getByRole("heading", { name: "Graphs" })).toBeVisible();
  await expect(page.locator("tbody tr td:first-child")).toHaveText([
    "Alice",
    "Bob",
    "Bobby Tables",
  ]);
});

test("data survives a reload", async ({ page }) => {
  await uploadFixture(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Go to graphs" })).toBeVisible();
  await expect(page.locator("nav")).toContainText("2 projects · 20 commits");
});

test("clearing data makes the guard redirect", async ({ page }) => {
  await uploadFixture(page);
  await page.getByRole("button", { name: "Clear data" }).click();
  await expect(page.getByRole("button", { name: "Go to graphs" })).toBeHidden();
  await page.getByRole("link", { name: "Graphs" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "Upload" })).toBeVisible();
});

test("?data= loads that dataset and drops the parameter", async ({ page }) => {
  await page.goto("/?data=tests/fixtures/small.json#/graphs");
  await expect(page.getByRole("heading", { name: "Graphs" })).toBeVisible();
  await expect(page.locator("nav")).toContainText("2 projects · 20 commits");
  expect(page.url()).not.toContain("data=");
  await page.reload();
  await expect(page.locator("nav")).toContainText("2 projects · 20 commits");
});

test("?data= with a bad URL shows why on the upload page", async ({ page }) => {
  await page.goto("/?data=missing.json#/graphs");
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load missing.json: fetching it failed with 404.",
  );
});
