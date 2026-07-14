// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlatformDot } from "@/components/ui/platform-dot";

afterEach(cleanup);

describe("PlatformDot", () => {
  it("renders an icon for a known platform (full name)", () => {
    const { container } = render(<PlatformDot platform="facebook" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders an icon for a known platform (short key)", () => {
    const { container } = render(<PlatformDot platform="ig" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a neutral fallback icon for a null platform without throwing", () => {
    let container: HTMLElement | undefined;
    expect(() => {
      container = render(<PlatformDot platform={null} />).container;
    }).not.toThrow();
    expect(container?.querySelector("svg")).not.toBeNull();
  });
});
