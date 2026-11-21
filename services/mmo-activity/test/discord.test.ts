import { expect, test } from "vite-plus/test";

import { inDiscord, launch, routes, SignInError } from "../src/discord.ts";

const local = {
  search: "?as=1234",
  origin: "http://localhost:18787",
  host: "localhost:18787",
  protocol: "http:",
};
const proxied = {
  search: "?frame_id=abc&instance_id=i-1&platform=mobile",
  origin: "https://1234.discordsays.com",
  host: "1234.discordsays.com",
  protocol: "https:",
};

test("outside Discord the routes are the listener's own", () => {
  expect(inDiscord(local)).toBe(false);
  expect(routes(local)).toEqual({
    token: "http://localhost:18787/api/activity/token",
    socket: "ws://localhost:18787/api/activity/ws",
    log: "http://localhost:18787/api/activity/log",
  });
});

test("inside Discord everything goes through its proxy", () => {
  expect(inDiscord(proxied)).toBe(true);
  expect(routes(proxied)).toEqual({
    token: "https://1234.discordsays.com/.proxy/api/activity/token",
    socket: "wss://1234.discordsays.com/.proxy/api/activity/ws",
    log: "https://1234.discordsays.com/.proxy/api/activity/log",
  });
});

test("outside Discord a named player signs in, with no credential in a URL", async () => {
  const l = await launch(local, "");
  expect(l).toMatchObject({ inDiscord: false, instance: "dev", platform: "browser" });
  expect(await l.signIn()).toEqual({ dev: "1234" });
});

test("outside Discord with nobody named, sign-in says so", async () => {
  const l = await launch({ search: "" }, "");
  await expect(l.signIn()).rejects.toBeInstanceOf(SignInError);
});
