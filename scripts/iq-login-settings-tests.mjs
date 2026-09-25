import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const grid = fs.readFileSync(path.join(root, "src", "http", "public", "grid.html"), "utf8");
const edge = fs.readFileSync(path.join(root, "api", "http.ts"), "utf8");

assert.match(grid, /id="iqEmailInput"[^>]*type="email"/);
assert.match(grid, /id="iqPasswordInput"[^>]*type="password"/);
assert.match(grid, /id="iqLogin"/);
assert.match(grid, /apiStrict\("\/api\/iq\/connect"/);
assert.match(grid, /JSON\.stringify\(\{ email, password \}\)/);
assert.match(grid, /\$\("iqPasswordInput"\)\.value = ""/);
assert.match(grid, /id="iqTwoFactorInput"/);
assert.match(grid, /apiStrict\("\/api\/iq\/verify-2fa"/);
assert.doesNotMatch(grid, /localStorage\.(?:setItem|getItem).*iqPassword|sessionStorage\.(?:setItem|getItem).*iqPassword/);
assert.match(edge, /"\/api\/iq\/connect"/);
assert.match(edge, /"\/api\/iq\/verify-2fa"/);
assert.match(edge, /path === "\/api\/iq\/connect" \? \{ email:/);

console.log("IQ_LOGIN_SETTINGS_TESTS_OK");
