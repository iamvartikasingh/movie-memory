import { describe, expect, it } from "vitest";
import { favoriteMovieSchema, MOVIE_TITLE_MAX_LENGTH, parseFavoriteMovieForm } from "@/lib/validation";

describe("favoriteMovieSchema", () => {
  it("trims and collapses whitespace", () => {
    expect(favoriteMovieSchema.parse("  The   Grand\tBudapest\nHotel  ")).toBe("The Grand Budapest Hotel");
  });

  it("rejects empty and whitespace-only titles", () => {
    expect(favoriteMovieSchema.safeParse("").success).toBe(false);
    expect(favoriteMovieSchema.safeParse("   ").success).toBe(false);
  });

  it("enforces the maximum length after trimming", () => {
    const longest = "a".repeat(MOVIE_TITLE_MAX_LENGTH);
    expect(favoriteMovieSchema.parse(`  ${longest}  `)).toBe(longest);
    expect(favoriteMovieSchema.safeParse(`${longest}a`).success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(favoriteMovieSchema.safeParse("Alien\u0000").success).toBe(false);
  });
});

describe("parseFavoriteMovieForm", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  it("reads the title and a picked film's page id", () => {
    expect(parseFavoriteMovieForm(form({ favoriteMovie: " Heat ", wikipediaId: "42" }))).toEqual({
      success: true,
      movie: "Heat",
      wikipediaId: 42,
    });
  });

  it("ignores a missing or malformed page id", () => {
    for (const wikipediaId of ["", "0", "-1", "4.2", "abc", "1234567890"]) {
      expect(parseFavoriteMovieForm(form({ favoriteMovie: "Heat", wikipediaId }))).toMatchObject({ wikipediaId: null });
    }
    expect(parseFavoriteMovieForm(form({ favoriteMovie: "Heat" }))).toMatchObject({ wikipediaId: null });
  });
});
