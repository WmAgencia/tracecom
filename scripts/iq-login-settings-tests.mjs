import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const grid = fs.readFileSync(path.join(root, "src", "http", "public", "grid.html"), "utf8");
const edge = fs.readFileSync(path.join(root, "api", "http.ts"), "utf8");
const gate = fs.readFileSync(path.join(root, "src", "security", "operator-gate.ts"), "utf8");

assert.match(grid, /id="iqEmailInput"[^>]*type="email"/);
assert.match(grid, /id="iqPasswordInput"[^>]*type="password"/);
assert.match(grid, /id="iqLogin"/);
assert.match(grid, /apiStrict\("\/api\/iq\/connect"/);
assert.match(grid, /JSON\.stringify\(\{ email, password \}\)/);
assert.match(grid, /\$\("iqPasswordInput"\)\.value = ""/);
assert.doesNotMatch(grid, /iqTwoFactor|verifyIqTwoFactor|verify-2fa/);
assert.match(gate, /PANEL_ACTION_POSTS[\s\S]*"\/api\/iq\/connect"/);
assert.doesNotMatch(grid, /localStorage\.(?:setItem|getItem).*iqPassword|sessionStorage\.(?:setItem|getItem).*iqPassword/);
assert.match(edge, /"\/api\/iq\/connect"/);
assert.match(edge, /"\/api\/iq\/verify-2fa"/);
assert.match(edge, /path === "\/api\/iq\/connect" \? \{ email:/);

assert.match(grid, /E-mail ou senha não aceitos pela IQ Option/);
assert.match(grid, /result\?\.ws\?\.confirmed === true/);
assert.match(edge, /authErrorCode: result\.body\.authErrorCode/);
assert.match(edge, /ws: result\.body\.ws/);
console.log("IQ_LOGIN_SETTINGS_TESTS_OK");
