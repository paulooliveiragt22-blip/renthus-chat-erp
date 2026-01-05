import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LoginClient from "../app/login/LoginClient";

test("login page matches snapshot", () => {
    const markup = renderToStaticMarkup(<LoginClient />);
    const snapshotPath = path.join(process.cwd(), "tests", "__snapshots__", "login.snapshot.html");
    const expected = readFileSync(snapshotPath, "utf-8").trim();

    assert.equal(markup.trim(), expected);
});
