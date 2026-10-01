import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MerchantIcon, brandColors, plateColors } from "./MerchantIcon";

const kind = (c: HTMLElement) => c.querySelector("[data-merchant-icon]")!.getAttribute("data-merchant-icon");

describe("MerchantIcon", () => {
  it("first of: uploaded image, brand, monogram", () => {
    const { container, rerender } = render(<MerchantIcon text="K*SpotifySE" icon={{ image: "/api/icons/a.png", brand: "spotify" }} />);
    expect(kind(container)).toBe("image");
    rerender(<MerchantIcon text="K*SpotifySE" icon={{ brand: "spotify" }} />);
    expect(kind(container)).toBe("brand:spotify");
    rerender(<MerchantIcon text="K*SpotifySE" />);
    expect(kind(container)).toBe("monogram:K*SpotifySE");
    // A brand the web doesn't have: the monogram.
    rerender(<MerchantIcon text="Willys" icon={{ brand: "willys" }} />);
    expect(kind(container)).toBe("monogram:Willys");
  });

  it("an image that can't be loaded falls back to the brand or monogram", () => {
    const { container } = render(<MerchantIcon label="Min butik" icon={{ image: "/api/icons/borta.png" }} />);
    fireEvent.error(container.querySelector("img")!);
    expect(kind(container)).toBe("monogram:Min butik");
  });

  it("read out as the merchant's name, never a file name; hidden next to the written name", () => {
    const { getByRole, container, rerender } = render(<MerchantIcon label="Min butik" icon={{ image: "/api/icons/3fa9c1.png" }} />);
    expect(getByRole("img", { name: "Min butik" })).toBeTruthy();
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("Min butik");
    rerender(<MerchantIcon label="Min butik" icon={{ image: "/api/icons/3fa9c1.png" }} decorative />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("img")!.getAttribute("alt")).toBe("");
    rerender(<MerchantIcon text="Swish skickad +46701234567" />);
    expect(kind(container)).toBe("person");
  });

  it("the brand's colour where it stands out on the badge, the theme's text colour where it doesn't", () => {
    expect(brandColors("#000000")).toEqual({ light: "#000000", dark: "var(--foreground)" });
    expect(brandColors("#1ED760")).toEqual({ light: "var(--foreground)", dark: "#1ED760" });
    expect(brandColors("#E50914")).toEqual({ light: "#E50914", dark: "#E50914" });
  });

  it("puts the merchant's own colour, thinly, behind a picture or a brand mark", () => {
    // The same merchant always gets the same plate, and it isn't the plain badge.
    const spotify = plateColors("Spotify");
    expect(plateColors("Spotify")).toEqual(spotify);
    expect(spotify.light).not.toBe("#f1f5f9");
    expect(plateColors("Willys").light).not.toBe(spotify.light);
    // Without a merchant (a Swish number with no contact) it stays neutral.
    expect(plateColors(null)).toEqual({ light: "#f1f5f9", dark: "#1a1e26" });

    const { container } = render(<MerchantIcon text="K*SpotifySE" icon={{ brand: "spotify" }} />);
    const badge = container.querySelector("[data-merchant-icon]") as HTMLElement;
    expect(badge.style.getPropertyValue("--plate-light")).toBe(spotify.light);
    // The brand's colour is judged against the tinted plate, not against grey.
    expect(badge.style.getPropertyValue("--brand-light")).toBe(brandColors("#1ED760", spotify).light);
  });
});
