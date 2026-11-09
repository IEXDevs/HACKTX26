import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("crawler metadata access", () => {
  it.each(["/robots.txt", "/sitemap.xml", "/sitemap.xml?source=search-console"])(
    "serves %s without the authentication proxy",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
    },
  );

  it.each(["/", "/login", "/agents", "/api/credentials", "/robots.txt/private", "/robotsXtxt", "/sitemap.xml/private"])(
    "keeps the authentication proxy on %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    },
  );
});
